import React, { useEffect, useRef, useCallback } from 'react';
import Codemirror from 'codemirror';
import 'codemirror/lib/codemirror.css';
import 'codemirror/theme/dracula.css';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/addon/edit/closetag';
import 'codemirror/addon/edit/closebrackets';
import ACTIONS from '../Actions';

const Editor = ({ socketRef, roomId, onCodeChange }) => {
    const editorRef = useRef(null);
    
    // Memoize the code change handler
    const handleCodeChange = useCallback((code) => {
        onCodeChange(code);
    }, [onCodeChange]);
    
    // Initialize editor only once
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
    
    // Handle editor changes
    useEffect(() => {
        if (!editorRef.current) return;
        
        const handleChange = (instance, changes) => {
            const { origin } = changes;
            const code = instance.getValue();
            
            handleCodeChange(code);
            
            if (origin !== 'setValue' && socketRef.current) {
                socketRef.current.emit(ACTIONS.CODE_CHANGE, {
                    roomId,
                    code,
                });
            }
        };
        
        editorRef.current.on('change', handleChange);
        
        return () => {
            if (editorRef.current) {
                editorRef.current.off('change', handleChange);
            }
        };
    }, [handleCodeChange, roomId, socketRef]);

    // Handle incoming socket messages
    useEffect(() => {
        const socket = socketRef.current;
        if (!socket) return;
        
        const handleIncomingCodeChange = ({ code }) => {
            if (code !== null && editorRef.current) {
                editorRef.current.setValue(code);
            }
        };
        
        socket.on(ACTIONS.CODE_CHANGE, handleIncomingCodeChange);
        
        return () => {
            if (socket) {
                socket.off(ACTIONS.CODE_CHANGE, handleIncomingCodeChange);
            }
        };
    }, [socketRef]);

    return <textarea id="realtimeEditor"></textarea>;
};

export default Editor;
