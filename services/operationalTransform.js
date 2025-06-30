const config = require('../config/environment');
const logger = require('./logger');

// Operation types
const OP_TYPES = {
  INSERT: 'insert',
  DELETE: 'delete',
  RETAIN: 'retain'
};

class Operation {
  constructor(type, position, content = '', length = 0) {
    this.type = type;
    this.position = position;
    this.content = content;
    this.length = length;
    this.timestamp = Date.now();
    this.id = this.generateId();
  }

  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  static insert(position, content) {
    return new Operation(OP_TYPES.INSERT, position, content, content.length);
  }

  static delete(position, length) {
    return new Operation(OP_TYPES.DELETE, position, '', length);
  }

  static retain(length) {
    return new Operation(OP_TYPES.RETAIN, 0, '', length);
  }
}

class OperationalTransform {
  constructor() {
    this.operationQueues = new Map(); // roomId -> operation queue
    this.documentStates = new Map(); // roomId -> document state
    this.maxQueueSize = config.OT.MAX_OPERATION_QUEUE_SIZE;
  }

  // Initialize room for OT
  initializeRoom(roomId, initialContent = '') {
    if (!this.operationQueues.has(roomId)) {
      this.operationQueues.set(roomId, []);
      this.documentStates.set(roomId, {
        content: initialContent,
        version: 0,
        lastModified: Date.now()
      });
      logger.info(`Initialized OT for room: ${roomId}`);
    }
  }

  // Apply operation to document
  applyOperation(roomId, operation, authorId) {
    const startTime = Date.now();
    
    try {
      this.initializeRoom(roomId);
      
      const state = this.documentStates.get(roomId);
      const queue = this.operationQueues.get(roomId);

      // Transform operation against concurrent operations
      const transformedOp = this.transformOperation(operation, queue, authorId);
      
      // Apply the transformed operation
      const newContent = this.executeOperation(state.content, transformedOp);
      
      // Update document state
      state.content = newContent;
      state.version++;
      state.lastModified = Date.now();
      
      // Add operation to queue
      transformedOp.version = state.version;
      transformedOp.authorId = authorId;
      queue.push(transformedOp);
      
      // Trim queue if too large
      if (queue.length > this.maxQueueSize) {
        queue.splice(0, queue.length - this.maxQueueSize);
      }

      logger.performance('OT Apply Operation', startTime, {
        roomId,
        operation: transformedOp.type,
        version: state.version,
        authorId
      });

      return {
        success: true,
        operation: transformedOp,
        content: newContent,
        version: state.version
      };
    } catch (error) {
      logger.errorWithContext('Failed to apply OT operation', error, {
        roomId,
        operation,
        authorId
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Transform operation against concurrent operations
  transformOperation(operation, concurrentOps, authorId) {
    let transformedOp = { ...operation };
    
    // Find operations that need to be transformed against
    const relevantOps = concurrentOps.filter(op => 
      op.timestamp > operation.timestamp - 5000 && // 5 second window
      op.authorId !== authorId
    );

    for (const concurrentOp of relevantOps) {
      transformedOp = this.transform(transformedOp, concurrentOp);
    }

    return transformedOp;
  }

  // Core transformation algorithm
  transform(op1, op2) {
    // Insert vs Insert
    if (op1.type === OP_TYPES.INSERT && op2.type === OP_TYPES.INSERT) {
      if (op1.position <= op2.position) {
        return {
          ...op1,
          position: op1.position
        };
      } else {
        return {
          ...op1,
          position: op1.position + op2.length
        };
      }
    }

    // Insert vs Delete
    if (op1.type === OP_TYPES.INSERT && op2.type === OP_TYPES.DELETE) {
      if (op1.position <= op2.position) {
        return op1;
      } else if (op1.position > op2.position + op2.length) {
        return {
          ...op1,
          position: op1.position - op2.length
        };
      } else {
        return {
          ...op1,
          position: op2.position
        };
      }
    }

    // Delete vs Insert
    if (op1.type === OP_TYPES.DELETE && op2.type === OP_TYPES.INSERT) {
      if (op1.position < op2.position) {
        return op1;
      } else {
        return {
          ...op1,
          position: op1.position + op2.length
        };
      }
    }

    // Delete vs Delete
    if (op1.type === OP_TYPES.DELETE && op2.type === OP_TYPES.DELETE) {
      if (op1.position + op1.length <= op2.position) {
        return op1;
      } else if (op1.position >= op2.position + op2.length) {
        return {
          ...op1,
          position: op1.position - op2.length
        };
      } else {
        // Overlapping deletes - complex case
        return this.handleOverlappingDeletes(op1, op2);
      }
    }

    return op1;
  }

  // Handle overlapping delete operations
  handleOverlappingDeletes(op1, op2) {
    const start1 = op1.position;
    const end1 = op1.position + op1.length;
    const start2 = op2.position;
    const end2 = op2.position + op2.length;

    // Calculate the remaining delete operation after op2
    const newStart = Math.max(start1, end2);
    const newEnd = Math.max(end1 - Math.max(0, Math.min(end1, end2) - Math.max(start1, start2)), newStart);
    
    return {
      ...op1,
      position: Math.min(newStart, start2),
      length: newEnd - Math.min(newStart, start2)
    };
  }

  // Execute operation on content
  executeOperation(content, operation) {
    const chars = Array.from(content); // Handle Unicode properly
    
    switch (operation.type) {
      case OP_TYPES.INSERT:
        chars.splice(operation.position, 0, ...Array.from(operation.content));
        return chars.join('');
        
      case OP_TYPES.DELETE:
        chars.splice(operation.position, operation.length);
        return chars.join('');
        
      default:
        return content;
    }
  }

  // Create operation from text difference
  createOperationFromDiff(oldText, newText, cursorPosition = 0) {
    const oldChars = Array.from(oldText);
    const newChars = Array.from(newText);
    
    // Find the first difference
    let start = 0;
    while (start < Math.min(oldChars.length, newChars.length) && 
           oldChars[start] === newChars[start]) {
      start++;
    }

    // Find the last difference
    let oldEnd = oldChars.length;
    let newEnd = newChars.length;
    while (oldEnd > start && newEnd > start && 
           oldChars[oldEnd - 1] === newChars[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }

    // Determine operation type
    const deletedLength = oldEnd - start;
    const insertedText = newChars.slice(start, newEnd).join('');
    
    if (deletedLength > 0 && insertedText.length > 0) {
      // Replace operation (delete + insert)
      return [
        Operation.delete(start, deletedLength),
        Operation.insert(start, insertedText)
      ];
    } else if (deletedLength > 0) {
      // Delete operation
      return [Operation.delete(start, deletedLength)];
    } else if (insertedText.length > 0) {
      // Insert operation
      return [Operation.insert(start, insertedText)];
    }
    
    return []; // No changes
  }

  // Get document state
  getDocumentState(roomId) {
    return this.documentStates.get(roomId) || null;
  }

  // Get operation history
  getOperationHistory(roomId, limit = 100) {
    const queue = this.operationQueues.get(roomId) || [];
    return queue.slice(-limit);
  }

  // Synchronize client with server state
  synchronizeClient(roomId, clientVersion, clientContent) {
    const startTime = Date.now();
    
    try {
      const state = this.documentStates.get(roomId);
      if (!state) {
        return {
          success: false,
          error: 'Room not found'
        };
      }

      const queue = this.operationQueues.get(roomId) || [];
      
      // Find operations after client version
      const missedOps = queue.filter(op => op.version > clientVersion);
      
      logger.performance('OT Client Sync', startTime, {
        roomId,
        clientVersion,
        serverVersion: state.version,
        missedOperations: missedOps.length
      });

      return {
        success: true,
        serverContent: state.content,
        serverVersion: state.version,
        missedOperations: missedOps,
        needsSync: missedOps.length > 0
      };
    } catch (error) {
      logger.errorWithContext('Failed to synchronize client', error, {
        roomId,
        clientVersion
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Clean up old operations and rooms
  cleanup() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [roomId, state] of this.documentStates.entries()) {
      if (now - state.lastModified > maxAge) {
        this.documentStates.delete(roomId);
        this.operationQueues.delete(roomId);
        logger.info(`Cleaned up OT state for room: ${roomId}`);
      }
    }
  }

  // Get metrics
  getMetrics() {
    return {
      activeRooms: this.documentStates.size,
      totalOperations: Array.from(this.operationQueues.values())
        .reduce((sum, queue) => sum + queue.length, 0),
      averageQueueSize: this.operationQueues.size > 0 
        ? Array.from(this.operationQueues.values())
            .reduce((sum, queue) => sum + queue.length, 0) / this.operationQueues.size
        : 0
    };
  }
}

// Export singleton instance
module.exports = new OperationalTransform(); 