
  const canvasParent = document.getElementById('canvas-parent');
  const blueFilter = document.getElementById('blue-filter');
  const weirdFilter = document.getElementById('weird-filter');
  const gpuEnabled = document.getElementById('gpu-enabled');
  const fpsNumber = document.getElementById('fps-number');
  let lastCalledTime = Date.now();
  let fps;
  let delta;
  let dispose = setup();
  gpuEnabled.onchange = () => {
    if (dispose) dispose();
    dispose = setup();
  };


  function setup() {
    let disposed = false;
    const gpu = new GPU({ mode: gpuEnabled.checked ? 'gpu' : 'cpu' });

    // THIS IS THE IMPORTANT STUFF
      const kernel = gpu.createKernel(function (frame, blueFilter) {
          const pixel = frame[this.thread.y][this.thread.x];
          if (blueFilter) {
              this.color(1-pixel.r, 20-pixel.g, 147-pixel.b, pixel.a);
          }
	    else {
              this.color(pixel.r, pixel.g, pixel.b, pixel.a);
          }
      }, {
      output: [1024, 768],
      graphical: true,
      tactic: 'precision'
    });

    canvasParent.appendChild(kernel.canvas);
    const videoElement = document.querySelector('video');
    function render() {
      if (disposed) {
        return;
      }
      kernel(videoElement,  blueFilter.checked);
      window.requestAnimationFrame(render);
      calcFPS();
    }

    render();
    return () => {
      canvasParent.removeChild(kernel.canvas);
      gpu.destroy();
      disposed = true;
    };

}


  function streamHandler(stream) {
    try {
      video.srcObject = stream;
    } catch (error) {
      video.src = URL.createObjectURL(stream);
    }
    video.play();
    console.log("In startStream");
    requestAnimationFrame(render);
  }


  addEventListener("DOMContentLoaded", initialize);

  function calcFPS() {
    delta = (Date.now() - lastCalledTime) / 1000;
    lastCalledTime = Date.now();
    fps = 1 / delta;
    fpsNumber.innerHTML = fps.toFixed(0);
  }

