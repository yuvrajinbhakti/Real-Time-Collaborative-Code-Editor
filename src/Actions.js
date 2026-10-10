const ACTIONS = {
    JOIN: 'join',
    JOINED: 'joined',
    DISCONNECTED: 'disconnected',
    LEAVE: 'leave',
    AI_REVIEW_CREATED: 'ai_review_created',
    REVIEW_COMMENT_ADDED: 'review_comment_added',

    // Operational transform. Clients send edits, not documents.
    //
    // CODE_CHANGE and SYNC_CODE used to carry the whole file in both directions,
    // which meant concurrent edits overwrote each other rather than merging and
    // a joiner had to be sent the text by a peer. They are gone; the server owns
    // the document now. See ot-rooms.js.
    SYNC: 'ot-sync', // client -> server: I am ready, send me the document
    INIT: 'ot-init', // server -> client: the document and its revision
    OPERATION: 'ot-op', // client -> server, and server -> everyone else
    ACK: 'ot-ack', // server -> author: your edit landed, at this revision
    RESYNC: 'ot-resync', // client -> server: I am at revision N, what did I miss?
    MISSED: 'ot-missed', // server -> client: the operations after N, so it can rebase what it was holding
    OT_ERROR: 'ot-error', // server -> client: rejected, with a reason
    CURSOR: 'ot-cursor', // presence, deliberately off the operation channel
};

module.exports = ACTIONS;
