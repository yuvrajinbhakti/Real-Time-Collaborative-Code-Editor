import React from 'react'

const Home = () => {
  return (
    <div className="homePageWrapper">
      <div className="formWrapper">

<img className='homePageLogo' src="/code-sync.png"
 alt="code-sync-logo"></img>
 <h4 className='mainLabel'>Paste invitation ROOM ID</h4>
<div className='inputGroup'>
<input type='text' className='inputBox' placeholder='ROOM ID' />

<input type='text' className='inputBox' placeholder='USERNAME' />

<button className='btn joinbtn'>JOIN</button>

<span className='createInfo'>
If you don't have an invite then create &nbsp;
<a href="" className='createNewBtn'>New Room</a>
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
