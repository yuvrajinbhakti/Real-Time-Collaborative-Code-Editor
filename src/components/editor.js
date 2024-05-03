import React, { useEffect , useRef} from "react";
import Codemirror from "codemirror";
import "codemirror/theme/dracula.css";
import "codemirror/lib/codemirror.css";
import "codemirror/mode/javascript/javascript";
import "codemirror/addon/edit/closetag";
import "codemirror/addon/edit/closebrackets";

const Editor = () => {
 
  useEffect(() => {
    async function init() {
      Codemirror.fromTextArea(document.getElementById("realtimeEditor"), {
        mode: { name: "javaScript", json: true }, //to tell which languages we will support like c,c++,java,python, javascript,...   (for each of them we also need to import some files as well)
        theme: "dracula",
        autoCloseTags: true,
        autoCloseBrackets: true,
        lineNumbers: true,
      });
    }
    init();
  }, []);
  return <textarea id="realtimeEditor"></textarea>;
};

export default Editor;

