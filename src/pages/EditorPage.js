//this is the editor page
import React, { useState, useRef, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import ACTIONS from '../Actions';
import Client from '../components/Client';
import Editor from '../components/Editor';
import AIReviewPanel from '../components/AIReviewPanel';
import { initSocket } from '../socket';
import {
    useLocation,
    useNavigate,
    Navigate,
    useParams,
} from 'react-router-dom';

const EditorPage = () => {
    const socketRef = useRef(null);
    const codeRef = useRef(null);
    const location = useLocation();
    const { roomId } = useParams();
    const reactNavigator = useNavigate();
    const [clients, setClients] = useState([]);
    const [showAIReview, setShowAIReview] = useState(false);
    const [currentLanguage, setCurrentLanguage] = useState('javascript');

    // Memoize the code change handler
    const handleCodeChange = useCallback((code) => {
        codeRef.current = code;
    }, []);

    useEffect(() => {
        const init = async () => {
            try {
                socketRef.current = await initSocket();
                
                socketRef.current.on('connect_error', (err) => {
                    console.error('Socket connection error:', err);
                    handleErrors(err);
                });
                
                socketRef.current.on('connect_failed', (err) => {
                    console.error('Socket connection failed:', err);
                    handleErrors(err);
                });

                socketRef.current.on('disconnect', (reason) => {
                    console.log('Socket disconnected:', reason);
                    if (reason === 'io server disconnect') {
                        // The disconnection was initiated by the server, reconnect manually
                        socketRef.current.connect();
                    }
                });

                function handleErrors(e) {
                    console.error('Socket error details:', e);
                    toast.error('Socket connection failed, try again later.');
                    // Don't immediately navigate away, give user a chance to retry
                    setTimeout(() => {
                        reactNavigator('/');
                    }, 3000);
                }

                socketRef.current.emit(ACTIONS.JOIN, {
                    roomId,
                    username: location.state?.username,
                });

                // Listening for joined event
                socketRef.current.on(
                    ACTIONS.JOINED,
                    ({ clients, username, socketId }) => {
                        if (username !== location.state?.username) {
                            toast.success(`${username} joined the room.`);
                            console.log(`${username} joined`);
                        }
                        setClients(clients);
                        socketRef.current.emit(ACTIONS.SYNC_CODE, {
                            code: codeRef.current,
                            socketId,
                        });
                    }
                );

                // Listening for disconnected
                socketRef.current.on(
                    ACTIONS.DISCONNECTED,
                    ({ socketId, username }) => {
                        toast.success(`${username} left the room.`);
                        setClients((prev) => {
                            return prev.filter(
                                (client) => client.socketId !== socketId
                            );
                        });
                    }
                );
            } catch (error) {
                console.error('Error initializing socket:', error);
                toast.error('Failed to initialize socket connection');
                setTimeout(() => {
                    reactNavigator('/');
                }, 3000);
            }
        };
        init();
        return () => {
            socketRef.current?.disconnect();
            socketRef.current?.off(ACTIONS.JOINED);
            socketRef.current?.off(ACTIONS.DISCONNECTED);
            socketRef.current?.off('connect_error');
            socketRef.current?.off('connect_failed');
            socketRef.current?.off('disconnect');
        };
    }, [roomId, location.state?.username, reactNavigator]);

    async function copyRoomId() {
        try {
            await navigator.clipboard.writeText(roomId);
            toast.success('Room ID has been copied to your clipboard');
        } catch (err) {
            toast.error('Could not copy the Room ID');
            console.error(err);
        }
    }

    function leaveRoom() {
        reactNavigator('/');
    }

    if (!location.state) {
        return <Navigate to="/" />;
    }

    return (
        <div className="mainWrap">
            <div className="aside">
                <div className="asideInner">
                    <div className="logo">
                        <img
                            className="logoImage"
                            src="/code-sync.png"
                            alt="logo"
                        />
                    </div>
                    <h3>Connected</h3>
                    <div className="clientsList">
                        {clients.map((client) => (
                            <Client
                                key={client.socketId}
                                username={client.username}
                            />
                        ))}
                    </div>
                </div>
                <button className="btn copyBtn" onClick={copyRoomId}>
                    Copy ROOM ID
                </button>
                <button 
                    className="btn aiReviewBtn" 
                    onClick={() => setShowAIReview(!showAIReview)}
                    style={{ 
                        background: showAIReview ? '#667eea' : '#2ed573',
                        marginBottom: '10px'
                    }}
                >
                    {showAIReview ? 'Hide' : 'Show'} AI Review
                </button>
                <button className="btn leaveBtn" onClick={leaveRoom}>
                    Leave
                </button>
            </div>
            <div className="editorWrap">
                <Editor
                    socketRef={socketRef}
                    roomId={roomId}
                    onCodeChange={handleCodeChange}
                />
            </div>
            {showAIReview && (
                <div className="aiReviewWrap">
                    <AIReviewPanel
                        roomId={roomId}
                        socketRef={socketRef}
                        currentCode={codeRef.current}
                        language={currentLanguage}
                    />
                </div>
            )}
        </div>
    );
};

export default EditorPage;
