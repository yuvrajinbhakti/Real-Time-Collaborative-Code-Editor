const mongoose = require('mongoose');
const crypto = require('crypto');

const roomSchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    maxlength: 500
  },
  roomId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Ownership & Access Control
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  visibility: {
    type: String,
    enum: ['public', 'private', 'unlisted'],
    default: 'private'
  },
  accessCode: {
    type: String,
    select: false
  },
  
  // Members & Roles
  members: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'editor', 'viewer'],
      default: 'editor'
    },
    permissions: {
      canEdit: {
        type: Boolean,
        default: true
      },
      canComment: {
        type: Boolean,
        default: true
      },
      canExecute: {
        type: Boolean,
        default: true
      },
      canInvite: {
        type: Boolean,
        default: false
      },
      canManage: {
        type: Boolean,
        default: false
      }
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    lastActive: {
      type: Date,
      default: Date.now
    },
    cursor: {
      line: Number,
      column: Number,
      file: String
    },
    selection: {
      start: {
        line: Number,
        column: Number
      },
      end: {
        line: Number,
        column: Number
      },
      file: String
    },
    status: {
      type: String,
      enum: ['active', 'idle', 'away', 'offline'],
      default: 'active'
    }
  }],
  
  // Collaboration Settings
  settings: {
    maxMembers: {
      type: Number,
      default: 10,
      min: 1,
      max: 100
    },
    allowAnonymous: {
      type: Boolean,
      default: false
    },
    requireApproval: {
      type: Boolean,
      default: false
    },
    enableChat: {
      type: Boolean,
      default: true
    },
    enableVoice: {
      type: Boolean,
      default: false
    },
    enableVideo: {
      type: Boolean,
      default: false
    },
    enableCodeExecution: {
      type: Boolean,
      default: true
    },
    enableFileUpload: {
      type: Boolean,
      default: true
    },
    enableGitIntegration: {
      type: Boolean,
      default: false
    },
    autoSave: {
      type: Boolean,
      default: true
    },
    saveInterval: {
      type: Number,
      default: 30000 // 30 seconds
    }
  },
  
  // Project Configuration
  project: {
    type: {
      type: String,
      enum: ['single-file', 'multi-file', 'git-repo'],
      default: 'single-file'
    },
    language: {
      type: String,
      default: 'javascript'
    },
    framework: {
      type: String
    },
    template: {
      type: String
    },
    environment: {
      type: String,
      enum: ['node', 'browser', 'python', 'java', 'cpp', 'custom'],
      default: 'browser'
    },
    dependencies: [{
      name: String,
      version: String,
      type: {
        type: String,
        enum: ['npm', 'pip', 'maven', 'custom'],
        default: 'npm'
      }
    }]
  },
  
  // Files & Content
  files: [{
    name: {
      type: String,
      required: true
    },
    path: {
      type: String,
      required: true
    },
    content: {
      type: String,
      default: ''
    },
    language: {
      type: String,
      default: 'javascript'
    },
    size: {
      type: Number,
      default: 0
    },
    lastModified: {
      type: Date,
      default: Date.now
    },
    lastModifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    version: {
      type: Number,
      default: 1
    },
    isDeleted: {
      type: Boolean,
      default: false
    }
  }],
  
  // Activity & Analytics
  activity: {
    totalSessions: {
      type: Number,
      default: 0
    },
    totalMinutes: {
      type: Number,
      default: 0
    },
    uniqueUsers: {
      type: Number,
      default: 0
    },
    lastActivity: {
      type: Date,
      default: Date.now
    },
    peakConcurrentUsers: {
      type: Number,
      default: 0
    }
  },
  
  // Git Integration
  git: {
    enabled: {
      type: Boolean,
      default: false
    },
    repository: {
      type: String
    },
    branch: {
      type: String,
      default: 'main'
    },
    lastCommit: {
      hash: String,
      message: String,
      author: String,
      timestamp: Date
    },
    credentials: {
      username: String,
      token: String // Encrypted
    }
  },
  
  // Comments & Annotations
  comments: [{
    id: {
      type: String,
      default: () => crypto.randomUUID()
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    content: {
      type: String,
      required: true,
      maxlength: 1000
    },
    file: {
      type: String,
      required: true
    },
    line: {
      type: Number,
      required: true
    },
    column: {
      type: Number
    },
    resolved: {
      type: Boolean,
      default: false
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    resolvedAt: {
      type: Date
    },
    replies: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      content: {
        type: String,
        required: true,
        maxlength: 1000
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }],
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Chat Messages
  chat: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    message: {
      type: String,
      required: true,
      maxlength: 500
    },
    type: {
      type: String,
      enum: ['text', 'system', 'file', 'code'],
      default: 'text'
    },
    metadata: {
      fileName: String,
      fileSize: Number,
      codeLanguage: String,
      codeSnippet: String
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    edited: {
      type: Boolean,
      default: false
    },
    editedAt: {
      type: Date
    }
  }],
  
  // Status & Lifecycle
  status: {
    type: String,
    enum: ['active', 'archived', 'deleted'],
    default: 'active'
  },
  isPublic: {
    type: Boolean,
    default: false
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  archivedAt: {
    type: Date
  },
  expiresAt: {
    type: Date
  },
  
  // Security & Monitoring
  security: {
    encryptionEnabled: {
      type: Boolean,
      default: false
    },
    encryptionKey: {
      type: String,
      select: false
    },
    auditLog: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      action: {
        type: String,
        required: true
      },
      details: {
        type: mongoose.Schema.Types.Mixed
      },
      ip: String,
      userAgent: String,
      timestamp: {
        type: Date,
        default: Date.now
      }
    }],
    blocked: {
      type: Boolean,
      default: false
    },
    blockedReason: {
      type: String
    },
    blockedAt: {
      type: Date
    }
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.accessCode;
      delete ret.security?.encryptionKey;
      delete ret.git?.credentials;
      delete ret.__v;
      return ret;
    }
  }
});

// Indexes for performance
roomSchema.index({ roomId: 1 });
roomSchema.index({ owner: 1 });
roomSchema.index({ 'members.user': 1 });
roomSchema.index({ status: 1, isArchived: 1 });
roomSchema.index({ visibility: 1, isPublic: 1 });
roomSchema.index({ 'activity.lastActivity': -1 });
roomSchema.index({ createdAt: -1 });
roomSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Virtuals
roomSchema.virtual('memberCount').get(function() {
  return this.members.length;
});

roomSchema.virtual('isExpired').get(function() {
  return this.expiresAt && this.expiresAt < new Date();
});

roomSchema.virtual('totalFiles').get(function() {
  return this.files.filter(f => !f.isDeleted).length;
});

roomSchema.virtual('totalSize').get(function() {
  return this.files.reduce((total, file) => total + file.size, 0);
});

// Methods
roomSchema.methods.generateAccessCode = function() {
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  this.accessCode = code;
  return code;
};

roomSchema.methods.addMember = function(userId, role = 'editor') {
  const existingMember = this.members.find(m => m.user.toString() === userId.toString());
  if (existingMember) {
    return false;
  }
  
  this.members.push({
    user: userId,
    role: role,
    permissions: this.getDefaultPermissions(role)
  });
  
  return true;
};

roomSchema.methods.removeMember = function(userId) {
  this.members = this.members.filter(m => m.user.toString() !== userId.toString());
};

roomSchema.methods.updateMemberRole = function(userId, newRole) {
  const member = this.members.find(m => m.user.toString() === userId.toString());
  if (member) {
    member.role = newRole;
    member.permissions = this.getDefaultPermissions(newRole);
    return true;
  }
  return false;
};

roomSchema.methods.getDefaultPermissions = function(role) {
  const permissions = {
    owner: {
      canEdit: true,
      canComment: true,
      canExecute: true,
      canInvite: true,
      canManage: true
    },
    admin: {
      canEdit: true,
      canComment: true,
      canExecute: true,
      canInvite: true,
      canManage: true
    },
    editor: {
      canEdit: true,
      canComment: true,
      canExecute: true,
      canInvite: false,
      canManage: false
    },
    viewer: {
      canEdit: false,
      canComment: true,
      canExecute: false,
      canInvite: false,
      canManage: false
    }
  };
  
  return permissions[role] || permissions.viewer;
};

roomSchema.methods.canUserPerformAction = function(userId, action) {
  const member = this.members.find(m => m.user.toString() === userId.toString());
  if (!member) return false;
  
  const actionMap = {
    'edit': 'canEdit',
    'comment': 'canComment',
    'execute': 'canExecute',
    'invite': 'canInvite',
    'manage': 'canManage'
  };
  
  const permission = actionMap[action];
  return permission ? member.permissions[permission] : false;
};

roomSchema.methods.addFile = function(name, path, content = '', language = 'javascript') {
  const existingFile = this.files.find(f => f.path === path && !f.isDeleted);
  if (existingFile) {
    return false;
  }
  
  this.files.push({
    name,
    path,
    content,
    language,
    size: Buffer.byteLength(content, 'utf8'),
    lastModified: new Date(),
    version: 1
  });
  
  return true;
};

roomSchema.methods.updateFile = function(path, content, userId) {
  const file = this.files.find(f => f.path === path && !f.isDeleted);
  if (!file) return false;
  
  file.content = content;
  file.size = Buffer.byteLength(content, 'utf8');
  file.lastModified = new Date();
  file.lastModifiedBy = userId;
  file.version += 1;
  
  return true;
};

roomSchema.methods.deleteFile = function(path) {
  const file = this.files.find(f => f.path === path && !f.isDeleted);
  if (!file) return false;
  
  file.isDeleted = true;
  return true;
};

roomSchema.methods.addComment = function(userId, content, file, line, column) {
  const comment = {
    user: userId,
    content,
    file,
    line,
    column,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  this.comments.push(comment);
  return comment;
};

roomSchema.methods.addChatMessage = function(userId, message, type = 'text', metadata = {}) {
  const chatMessage = {
    user: userId,
    message,
    type,
    metadata,
    timestamp: new Date()
  };
  
  this.chat.push(chatMessage);
  
  // Keep only last 100 messages
  if (this.chat.length > 100) {
    this.chat = this.chat.slice(-100);
  }
  
  return chatMessage;
};

roomSchema.methods.updateActivity = function(userId) {
  this.activity.lastActivity = new Date();
  
  // Update member activity
  const member = this.members.find(m => m.user.toString() === userId.toString());
  if (member) {
    member.lastActive = new Date();
    member.status = 'active';
  }
};

roomSchema.methods.logAuditEvent = function(userId, action, details = {}, ip = null, userAgent = null) {
  this.security.auditLog.push({
    user: userId,
    action,
    details,
    ip,
    userAgent,
    timestamp: new Date()
  });
  
  // Keep only last 1000 audit events
  if (this.security.auditLog.length > 1000) {
    this.security.auditLog = this.security.auditLog.slice(-1000);
  }
};

roomSchema.methods.cleanup = function() {
  // Remove old chat messages (older than 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  this.chat = this.chat.filter(msg => msg.timestamp > sevenDaysAgo);
  
  // Remove old audit logs (older than 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  this.security.auditLog = this.security.auditLog.filter(log => log.timestamp > thirtyDaysAgo);
};

// Static methods
roomSchema.statics.findByRoomId = function(roomId) {
  return this.findOne({ roomId, status: 'active' });
};

roomSchema.statics.findUserRooms = function(userId, status = 'active') {
  return this.find({
    $or: [
      { owner: userId },
      { 'members.user': userId }
    ],
    status
  }).sort({ 'activity.lastActivity': -1 });
};

roomSchema.statics.findPublicRooms = function(limit = 50) {
  return this.find({
    visibility: 'public',
    isPublic: true,
    status: 'active'
  }).sort({ 'activity.lastActivity': -1 }).limit(limit);
};

module.exports = mongoose.model('Room', roomSchema); 