import React,{useState} from 'react'
import {v4 as uuidv4} from 'uuid';

const Home = () => {

  const [roomId,setRoomId]=useState('');
  const [Username,setUsername]=useState('');

    const createNewRoom=(e)=>{
  e.preventDefault();
  const id=uuidv4();
  setRoomId(id);
  };

  return (
    <div className="homePageWrapper">
      <div className="formWrapper">

<img className='homePageLogo' src="/code-sync.png"
 alt="code-sync-logo"></img>
 <h4 className='mainLabel'>Paste invitation ROOM ID</h4>
<div className='inputGroup'>
<input type='text' className='inputBox' placeholder='ROOM ID' 
onChange={(e)=>setRoomId(e.target.value)}
value={roomId}
/>

<input type='text' className='inputBox' placeholder='USERNAME' 
onChange={(e)=>setUsername(e.target.value)}
value={Username}
/>

<button className='btn joinBtn'>JOIN</button>

<span className='createInfo'>
If you don't have an invite then create &nbsp;
<a onClick={createNewRoom} href="" className='createNewBtn'>New Room</a>
</span>

</div>

       </div>

<footer>
  <h4>Built with ❤️ by <a href='https://github.com/yuvrajinbhakti/'>Yuvraj Singh Nain</a></h4>
</footer>


    </div>
  )
}

export default Home
