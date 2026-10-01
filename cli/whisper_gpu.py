"""faster-whisper wrapper for `ove transcript`: prints "[start --> end] text" lines as they are decoded.
usage: python whisper_gpu.py [--model small] [--cpu] file.wav      (CUDA first; falls back to CPU and prints OVE_DEVICE=cpu on stderr)"""
import os, sys, glob

def add_cuda_dlls():
    # pip's nvidia-cublas-cu12 / nvidia-cudnn-cu12 keep their DLLs/.so files inside site-packages/nvidia/*/bin|lib
    import site
    roots = site.getsitepackages() + [site.getusersitepackages()]
    for r in roots:
        for d in glob.glob(os.path.join(r, "nvidia", "*", "bin")) + glob.glob(os.path.join(r, "nvidia", "*", "lib")):
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
            if hasattr(os, "add_dll_directory"):
                try: os.add_dll_directory(d)
                except OSError: pass

def ts(x):
    m, s = divmod(x, 60)
    return "%02d:%06.3f" % (int(m), s)

def run(wav, model, device):
    from faster_whisper import WhisperModel
    m = WhisperModel(model, device=device, compute_type="float16" if device == "cuda" else "int8")
    segs, _ = m.transcribe(wav, language="en", vad_filter=True, beam_size=1, condition_on_previous_text=False, vad_parameters=dict(max_speech_duration_s=20, min_silence_duration_ms=400))
    n = 0
    for s in segs:
        t = s.text.strip()
        if t:
            print("[%s --> %s] %s" % (ts(s.start), ts(s.end), t), flush=True); n += 1
    return n

if __name__ == "__main__":
    a = sys.argv[1:]; model = "small"; cpu = False
    if "--model" in a: i = a.index("--model"); model = a[i + 1]; del a[i:i + 2]
    if "--cpu" in a: cpu = True; a.remove("--cpu")
    wav = a[0]
    add_cuda_dlls()
    if not cpu:
        try:
            run(wav, model, "cuda"); sys.exit(0)
        except Exception as e:
            sys.stderr.write("cuda failed: %s\n" % str(e)[:200])
    sys.stderr.write("OVE_DEVICE=cpu\n")
    run(wav, model, "cpu")
