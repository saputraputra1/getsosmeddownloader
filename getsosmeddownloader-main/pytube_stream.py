"""Stream YouTube video/audio via pytubefix to stdout."""
import sys
import json
import os

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive',
}

def stream_video(url, mode='video'):
    try:
        from pytubefix import YouTube
    except ImportError:
        from pytube import YouTube

    try:
        yt = YouTube(url)
    except Exception as e:
        print(json.dumps({"error": f"Gagal akses video: {str(e)}"}), file=sys.stderr)
        sys.exit(1)

    try:
        if mode == 'audio':
            stream = yt.streams.filter(only_audio=True).order_by('abr').desc().first()
        else:
            stream = yt.streams.get_highest_resolution()

        if not stream:
            print(json.dumps({"error": "Tidak ada stream tersedia"}), file=sys.stderr)
            sys.exit(1)

        # Gunakan urllib dengan header sama seperti PyTube internal
        import urllib.request
        req = urllib.request.Request(stream.url, headers=HEADERS)
        
        try:
            resp = urllib.request.urlopen(req, timeout=300)
        except Exception as e:
            # Fallback: download via PyTube ke temp file
            print(f"[pytube_stream] urllib gagal ({str(e)[:80]}), fallback ke download file...", file=sys.stderr)
            import tempfile
            suffix = '.mp3' if mode == 'audio' else '.mp4'
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
            tmp_name = tmp.name
            tmp.close()
            stream.download(output_path=os.path.dirname(tmp_name), filename=os.path.basename(tmp_name))
            import os as _os
            if _os.path.getsize(tmp_name) < 1024:
                _os.unlink(tmp_name)
                print(json.dumps({"error": "Downloaded file too small (likely blocked/IP restricted)"}), file=sys.stderr)
                sys.exit(1)
            with open(tmp_name, 'rb') as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()
            _os.unlink(tmp_name)
            return

        # Validate response: check content-type and first bytes
        content_type = resp.headers.get('Content-Type', '')
        if 'text/html' in content_type or 'application/json' in content_type:
            body_sample = resp.read(512).decode('utf-8', errors='replace')
            print(json.dumps({"error": f"Unexpected content-type: {content_type}, body: {body_sample[:200]}"}), file=sys.stderr)
            sys.exit(1)

        # Stream chunks ke stdout, check first chunk for validity
        first_chunk = True
        while True:
            chunk = resp.read(65536)
            if not chunk:
                break
            if first_chunk:
                first_chunk = False
                # Check if it looks like HTML (starts with <)
                if chunk[:1] == b'<':
                    sample = chunk[:200].decode('utf-8', errors='replace')
                    print(json.dumps({"error": f"Response looks like HTML/error page: {sample[:150]}"}), file=sys.stderr)
                    sys.exit(1)
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()
    except Exception as e:
        print(json.dumps({"error": f"Stream error: {str(e)}"}), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: pytube_stream.py <youtube_url> [video|audio]"}), file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else 'video'
    stream_video(url, mode)
