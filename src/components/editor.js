import React, { useEffect , useRef} from "react";
import Codemirror from "codemirror";
import "codemirror/theme/dracula.css";
import "codemirror/lib/codemirror.css";
import "codemirror/mode/javascript/javascript";
import "codemirror/addon/edit/closetag";
import "codemirror/addon/edit/closebrackets";
import ACTIONS, { CODE_CHANGE } from "../Actions";

const Editor = ({socketRef,roomId}) => {
 const EditorRef=useRef(null);
  useEffect(() => {
    async function init() {
     EditorRef.current=Codemirror.fromTextArea(document.getElementById("realtimeEditor"), {
        mode: { name: "javaScript", json: true }, //to tell which languages we will support like c,c++,java,python, javascript,...   (for each of them we also need to import some files as well)
        theme: "dracula",
        autoCloseTags: true,
        autoCloseBrackets: true,
        lineNumbers: true,
      });

      

      EditorRef.current.on('change',(instance,changes)=>{
        // console.log('changes',changes);
        const {origin}=changes;
        const code=instance.getValue();
        if(origin!=='setValue'){
          socketRef.current.emit(ACTIONS.CODE_CHANGE,{
            roomId,
            code
          });
        }
        console.log(code);
      });

      
    }
    init();
  }, []);

  useEffect(()=>{
if(socketRef.current){
    socketRef.current.on(ACTIONS.CODE_CHANGE,({code})=>{
      if(code!=null){
        EditorRef.current.setValue(code);
      }
            });
          }
          },[socketRef.current]);

  return <textarea id="realtimeEditor"></textarea>;
};

export default Editor;

