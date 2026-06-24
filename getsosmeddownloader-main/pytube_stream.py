"""Stream YouTube video/audio via pytubefix to stdout.
Support: audio, video (progressive), video with quality, HD adaptive + audio merge via ffmpeg."""
import sys
import json
import os
import subprocess
import tempfile
import urllib.request

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive',
}

def get_yt(url):
    try:
        from pytubefix import YouTube
    except ImportError:
        from pytube import YouTube
    try:
        return YouTube(url)
    except Exception as e:
        print(json.dumps({"error": f"Gagal akses video: {str(e)}"}), file=sys.stderr)
        sys.exit(1)


def stream_url_to_stdout(stream_url, is_audio=False, label="stream"):
    """Download URL and pipe to stdout, with validation."""
    try:
        req = urllib.request.Request(stream_url, headers=HEADERS)
        resp = urllib.request.urlopen(req, timeout=300)
    except Exception as e:
        raise Exception(f"urllib gagal: {str(e)[:80]}")

    ct = resp.headers.get('Content-Type', '')
    if 'text/html' in ct or 'application/json' in ct:
        body = resp.read(512).decode('utf-8', errors='replace')
        raise Exception(f"Unexpected content-type: {ct}, body: {body[:200]}")

    first_chunk = True
    while True:
        chunk = resp.read(65536)
        if not chunk:
            break
        if first_chunk:
            first_chunk = False
            if chunk[:1] == b'<':
                sample = chunk[:200].decode('utf-8', errors='replace')
                raise Exception(f"Response looks like HTML/error page: {sample[:150]}")
        sys.stdout.buffer.write(chunk)
        sys.stdout.buffer.flush()


def download_to_file(stream, suffix):
    """Download stream to temp file and return path."""
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp_name = tmp.name
    tmp.close()
    stream.download(output_path=os.path.dirname(tmp_name), filename=os.path.basename(tmp_name))
    if os.path.getsize(tmp_name) < 1024:
        os.unlink(tmp_name)
        raise Exception("Downloaded file too small (likely blocked/IP restricted)")
    return tmp_name


def merge_video_audio(video_stream, audio_stream):
    """Stream video+audio via ffmpeg merge to stdout."""
    video_url = video_stream.url
    audio_url = audio_stream.url

    ffmpeg_cmd = [
        'ffmpeg',
        '-i', video_url,
        '-i', audio_url,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-shortest',
        '-movflags', 'frag_keyframe+empty_moov',
        '-f', 'mp4',
        'pipe:1'
    ]

    proc = subprocess.Popen(
        ffmpeg_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    first_chunk = True
    while True:
        chunk = proc.stdout.read(65536)
        if not chunk:
            break
        if first_chunk:
            first_chunk = False
            if chunk[:1] == b'<':
                proc.kill()
                raise Exception("ffmpeg output looks like HTML")
        sys.stdout.buffer.write(chunk)
        sys.stdout.buffer.flush()

    proc.wait()
    if proc.returncode != 0:
        stderr = proc.stderr.read().decode('utf-8', errors='replace')[:200]
        raise Exception(f"ffmpeg exit {proc.returncode}: {stderr}")

    proc.stderr.close()


def stream_video(url, mode='video', quality=None):
    yt = get_yt(url)

    try:
        # ─── Mode Audio ───
        if mode == 'audio':
            stream = yt.streams.filter(only_audio=True).order_by('abr').desc().first()
            if not stream:
                raise Exception("Tidak ada audio stream")
            print(json.dumps({"info": f"Audio: {stream.abr}"}), file=sys.stderr)
            try:
                stream_url_to_stdout(stream.url, is_audio=True)
            except Exception as e:
                tmp = download_to_file(stream, '.mp3')
                with open(tmp, 'rb') as f:
                    while True:
                        chunk = f.read(65536)
                        if not chunk:
                            break
                        sys.stdout.buffer.write(chunk)
                os.unlink(tmp)
            return

        # ─── Mode Video dengan kualitas spesifik ───
        if quality:
            target_h = int(quality.replace('p', ''))

            # Coba progressive dulu (sudah include audio)
            prog_stream = yt.streams.filter(progressive=True, resolution=quality).first()

            # Cari adaptive video (HD, video-only)
            adap_stream = yt.streams.filter(only_video=True, resolution=quality).first()

            if prog_stream:
                # Progressive tersedia — stream langsung (audio sudah include)
                print(json.dumps({"info": f"Progressive: {prog_stream.resolution}"}), file=sys.stderr)
                try:
                    stream_url_to_stdout(prog_stream.url)
                except Exception as e:
                    tmp = download_to_file(prog_stream, '.mp4')
                    with open(tmp, 'rb') as f:
                        while True:
                            chunk = f.read(65536)
                            if not chunk:
                                break
                            sys.stdout.buffer.write(chunk)
                    os.unlink(tmp)
                return

            if adap_stream:
                # Adaptive video — perlu merge dengan audio via ffmpeg
                audio_stream = yt.streams.filter(only_audio=True).order_by('abr').desc().first()
                if audio_stream:
                    print(json.dumps({"info": f"Adaptive + Audio merge: {adap_stream.resolution} + {audio_stream.abr}"}), file=sys.stderr)
                    merge_video_audio(adap_stream, audio_stream)
                else:
                    # Tidak ada audio, stream video-only
                    print(json.dumps({"info": f"Adaptive only (no audio): {adap_stream.resolution}"}), file=sys.stderr)
                    try:
                        stream_url_to_stdout(adap_stream.url)
                    except Exception as e:
                        tmp = download_to_file(adap_stream, '.mp4')
                        with open(tmp, 'rb') as f:
                            while True:
                                chunk = f.read(65536)
                                if not chunk:
                                    break
                                sys.stdout.buffer.write(chunk)
                        os.unlink(tmp)
                return

            # Fallback: cari resolusi terdekat
            all_video = yt.streams.filter(progressive=True).order_by('resolution').desc()
            best = None
            for s in all_video:
                if s.resolution and int(s.resolution.replace('p', '')) <= target_h:
                    best = s
                    break
            if not best:
                best = yt.streams.get_highest_resolution()

            if best:
                print(json.dumps({"info": f"Fallback: {best.resolution}"}), file=sys.stderr)
                try:
                    stream_url_to_stdout(best.url)
                except Exception as e:
                    tmp = download_to_file(best, '.mp4')
                    with open(tmp, 'rb') as f:
                        while True:
                            chunk = f.read(65536)
                            if not chunk:
                                break
                            sys.stdout.buffer.write(chunk)
                    os.unlink(tmp)
                return

            raise Exception("Tidak ada stream video")

        # ─── Mode Video tanpa kualitas (highest resolution) ───
        stream = yt.streams.get_highest_resolution()
        if not stream:
            raise Exception("Tidak ada stream")
        print(json.dumps({"info": f"Auto: {stream.resolution}"}), file=sys.stderr)
        try:
            stream_url_to_stdout(stream.url)
        except Exception as e:
            tmp = download_to_file(stream, '.mp4')
            with open(tmp, 'rb') as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    sys.stdout.buffer.write(chunk)
            os.unlink(tmp)

    except Exception as e:
        print(json.dumps({"error": f"{str(e)}"}), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: pytube_stream.py <youtube_url> [video|audio] [quality]"}), file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else 'video'
    quality = sys.argv[3] if len(sys.argv) > 3 else None
    stream_video(url, mode, quality)
