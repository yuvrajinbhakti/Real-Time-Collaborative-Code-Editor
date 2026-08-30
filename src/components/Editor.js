import React, { useEffect, useRef, useCallback } from 'react';
import Codemirror from 'codemirror';
import 'codemirror/lib/codemirror.css';
import 'codemirror/theme/dracula.css';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/addon/edit/closetag';
import 'codemirror/addon/edit/closebrackets';
import { Client } from 'ot-core/client';
import { collaborate } from 'ot-core/codemirror5';
import { Presence, track } from 'ot-core/presence';
import { attachHistory } from 'ot-core/undo';
import ACTIONS from '../Actions';
import './remote-cursors.css';

/**
 * The editor, now sending edits instead of documents.
 *
 * This component used to emit `instance.getValue()` — the whole file — on every
 * keystroke, and call `setValue(code)` on every message that arrived. Two people
 * typing within a round trip of each other did not merge badly; the later
 * message replaced the entire document and the earlier person's work vanished.
 * `setValue` also reset the cursor, the scroll position and the undo history of
 * everybody who was not the one typing.
 *
 * Now it holds an `ot-core` Client, which keeps one operation on the wire at a
 * time, buffers what you type while waiting, and rebases arriving operations
 * past everything you have not had acknowledged yet. The server orders them. The
 * binding between that and CodeMirror lives in the library rather than here.
 */

/** Stable per-user colour, so somebody's cursor is the same colour for everyone. */
function colourFor(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
    return `hsl(${Math.abs(hash) % 360} 85% 62%)`;
}

const Editor = ({ socket: socketProp, socketRef, roomId, onCodeChange }) => {
    const editorRef = useRef(null);
    const clientRef = useRef(null);
    const presenceRef = useRef(null);
    const markersRef = useRef([]);

    const handleCodeChange = useCallback(
        (code) => {
            onCodeChange(code);
        },
        [onCodeChange]
    );

    // The editor itself, created once.
    useEffect(() => {
        if (!editorRef.current) {
            editorRef.current = Codemirror.fromTextArea(
                document.getElementById('realtimeEditor'),
                {
                    mode: { name: 'javascript', json: true },
                    theme: 'dracula',
                    autoCloseTags: true,
                    autoCloseBrackets: true,
                    lineNumbers: true,
                }
            );
        }

        return () => {
            if (editorRef.current) {
                editorRef.current.toTextArea();
                editorRef.current = null;
            }
        };
    }, []);

    // The collaborative half. Waits for the server's document rather than
    // assuming the editor starts empty, because a joiner arrives mid-session.
    useEffect(() => {
        // The prop, not the ref: `initSocket` is awaited, so on the first render
        // the ref is still null and an effect keyed on it would never run again.
        const socket = socketProp ?? socketRef.current;
        const cm = editorRef.current;
        if (!socket || !cm) return undefined;

        let detachEditor = null;
        let detachPresence = null;
        let history = null;
        // INIT arrives asynchronously, so two things can go wrong and both did.
        // A second INIT would re-run setValue while the binding was already
        // attached, which reports replacing the document as an edit and wipes
        // the room. And an INIT arriving after this effect was torn down would
        // attach a binding that nothing ever detaches.
        let started = false;
        let cancelled = false;

        const drawCursors = (peers) => {
            for (const marker of markersRef.current) marker.clear();
            markersRef.current = [];

            const text = cm.getValue();
            for (const peer of peers) {
                const at = cm.posFromIndex(codeUnitsFrom(text, peer.selection.head));
                const element = document.createElement('span');
                element.className = 'remote-cursor';
                element.style.borderColor = colourFor(peer.id);
                if (peer.meta.username) {
                    const label = document.createElement('span');
                    label.className = 'remote-cursor-label';
                    label.style.background = colourFor(peer.id);
                    label.textContent = peer.meta.username;
                    element.appendChild(label);
                }
                markersRef.current.push(cm.setBookmark(at, { widget: element }));
            }
        };

        const onInit = ({ document: text, revision, cursors }) => {
            if (started || cancelled) return;
            started = true;

            // Replacing the whole document is correct exactly once — here, on
            // arrival, before there is any local state to lose.
            cm.setValue(text);

            const client = new Client({
                id: socket.id,
                document: text,
                revision,
                send: (message) => socket.emit(ACTIONS.OPERATION, { roomId, message }),
                onError: ({ reason }) => console.error('[ot]', reason),
            });
            clientRef.current = client;

            const presence = new Presence({ onChange: drawCursors });
            presenceRef.current = presence;
            detachPresence = track(client, presence);

            history = attachHistory(client);
            // CodeMirror's own undo would undo *everyone's* edits, because from
            // its point of view a remote operation is just another change to the
            // document. The collaborative stack undoes only your own.
            cm.setOption('extraKeys', {
                ...(cm.getOption('extraKeys') || {}),
                'Ctrl-Z': () => history.undo(),
                'Cmd-Z': () => history.undo(),
                'Shift-Ctrl-Z': () => history.redo(),
                'Shift-Cmd-Z': () => history.redo(),
            });

            detachEditor = collaborate(cm, client);

            for (const { socketId, selection, revision: at, username } of cursors ?? []) {
                presence.see(socketId, selection, { revision: at, meta: { username } });
            }

            handleCodeChange(text);
        };

        const onOperation = (message) => {
            clientRef.current?.receive(message);
            handleCodeChange(clientRef.current.document);
        };

        const onAck = (message) => clientRef.current?.receive(message);

        const onCursor = ({ socketId, selection, revision, username }) => {
            presenceRef.current?.see(socketId, selection, {
                revision,
                meta: { username },
            });
        };

        const onDisconnected = ({ socketId }) => presenceRef.current?.forget(socketId);

        const onOtError = ({ reason }) => console.error('[ot] rejected:', reason);

        socket.on(ACTIONS.INIT, onInit);
        // Ask, rather than waiting for the JOIN broadcast — that broadcast can
        // be sent before this component has mounted its listener.
        socket.emit(ACTIONS.SYNC, { roomId });
        socket.on(ACTIONS.OPERATION, onOperation);
        socket.on(ACTIONS.ACK, onAck);
        socket.on(ACTIONS.CURSOR, onCursor);
        socket.on(ACTIONS.DISCONNECTED, onDisconnected);
        socket.on(ACTIONS.OT_ERROR, onOtError);

        // Our own cursor, reported on movement. Throttled by the browser's own
        // event rate rather than a timer: `cursorActivity` fires once per
        // interaction, not once per frame.
        const onCursorActivity = () => {
            const client = clientRef.current;
            if (!client) return;
            const text = cm.getValue();
            const selection = {
                anchor: codePointsIn(text, cm.indexFromPos(cm.getCursor('anchor'))),
                head: codePointsIn(text, cm.indexFromPos(cm.getCursor('head'))),
            };
            socket.emit(ACTIONS.CURSOR, { roomId, selection, revision: client.revision });
        };
        cm.on('cursorActivity', onCursorActivity);

        // Also report the local document upward whenever it changes, so the
        // download and AI-review features keep seeing current text.
        const onLocalChange = () => handleCodeChange(cm.getValue());
        cm.on('changes', onLocalChange);

        return () => {
            cancelled = true;
            socket.off(ACTIONS.INIT, onInit);
            socket.off(ACTIONS.OPERATION, onOperation);
            socket.off(ACTIONS.ACK, onAck);
            socket.off(ACTIONS.CURSOR, onCursor);
            socket.off(ACTIONS.DISCONNECTED, onDisconnected);
            socket.off(ACTIONS.OT_ERROR, onOtError);
            cm.off('cursorActivity', onCursorActivity);
            cm.off('changes', onLocalChange);
            detachEditor?.();
            detachPresence?.();
            history?.detach();
            for (const marker of markersRef.current) marker.clear();
            markersRef.current = [];
            clientRef.current = null;
            presenceRef.current = null;
        };
    }, [socketProp, socketRef, roomId, handleCodeChange]);

    return <textarea id="realtimeEditor"></textarea>;
};

/**
 * CodeMirror counts UTF-16 code units; ot-core counts code points, so an emoji
 * is two to one and one to the other. The binding converts everything it
 * handles, but cursor reporting happens here, so these two do the same job for
 * the positions this component sends and draws.
 */
function codePointsIn(text, offset) {
    const clamped = Math.max(0, Math.min(offset, text.length));
    return [...text.slice(0, clamped)].length;
}

function codeUnitsFrom(text, position) {
    if (position <= 0) return 0;
    let seen = 0;
    for (let i = 0; i < text.length; i++) {
        if (seen === position) return i;
        const unit = text.charCodeAt(i);
        if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
            const next = text.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) i++;
        }
        seen++;
    }
    return text.length;
}

export default Editor;
