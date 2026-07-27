"""Stream YouTube video/audio via pytubefix to stdout.
Support: audio, video (progressive), video with quality, HD adaptive + audio merge via ffmpeg."""
import sys
import json
import os
import subprocess
import tempfile
import urllib.request
import http.cookiejar
import time
import ssl

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive',
    'Origin': 'https://www.youtube.com',
    'Referer': 'https://www.youtube.com/',
}

# Create SSL context that doesn't verify (for some proxy scenarios)
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE


def get_yt(url):
    try:
        from pytubefix import YouTube
    except ImportError:
        from pytube import YouTube
    try:
        yt = YouTube(url, use_po_token=False)
        return yt
    except Exception as e:
        print(json.dumps({"error": f"Gagal akses video: {str(e)}"}), file=sys.stderr)
        sys.exit(1)


def stream_url_to_stdout(stream_url, is_audio=False, label="stream", max_retries=3):
    """Download URL and pipe to stdout, with retry and validation."""
    last_err = None
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(stream_url, headers=HEADERS)
            resp = urllib.request.urlopen(req, timeout=300, context=SSL_CTX)
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
            return  # success
        except Exception as e:
            last_err = e
            if attempt < max_retries - 1:
                time.sleep(1)
                continue
            raise Exception(f"urllib gagal after {max_retries} attempts: {str(last_err)[:120]}")


def download_to_file(stream, suffix, max_retries=3):
    """Download stream to temp file and return path, with retry."""
    last_err = None
    for attempt in range(max_retries):
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        tmp_name = tmp.name
        tmp.close()
        try:
            stream.download(output_path=os.path.dirname(tmp_name), filename=os.path.basename(tmp_name))
            size = os.path.getsize(tmp_name)
            if size < 1024:
                os.unlink(tmp_name)
                raise Exception("Downloaded file too small (likely blocked/IP restricted)")
            return tmp_name
        except Exception as e:
            last_err = e
            if os.path.exists(tmp_name):
                try:
                    os.unlink(tmp_name)
                except:
                    pass
            if attempt < max_retries - 1:
                time.sleep(1)
                continue
            raise Exception(f"Download gagal after {max_retries} attempts: {str(last_err)[:120]}")


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
            print(json.dumps({"info": f"Audio: {stream.abr} (converting to MP3...)"}), file=sys.stderr)
            # Always use ffmpeg to convert WebM/Opus to MP3
            audio_url = stream.url
            ffmpeg_cmd = [
                'ffmpeg',
                '-i', audio_url,
                '-vn',
                '-c:a', 'libmp3lame',
                '-b:a', '192k',
                '-f', 'mp3',
                'pipe:1'
            ]
            try:
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
                    stderr_out = proc.stderr.read().decode('utf-8', errors='replace')[:200]
                    raise Exception(f"ffmpeg exit {proc.returncode}: {stderr_out}")
                proc.stderr.close()
            except Exception as e:
                # Fallback: download raw WebM and output as-is
                print(json.dumps({"info": f"ffmpeg gagal, output raw: {str(e)[:60]}"}), file=sys.stderr)
                try:
                    stream_url_to_stdout(audio_url, is_audio=True)
                except Exception as e2:
                    tmp = download_to_file(stream, '.webm')
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
                print(json.dumps({"info": f"Progressive: {prog_stream.resolution}"}), file=sys.stderr)
                try:
                    stream_url_to_stdout(prog_stream.url)
                except Exception as e:
                    print(json.dumps({"info": f"URL stream gagal, fallback download: {str(e)[:60]}"}), file=sys.stderr)
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
                audio_stream = yt.streams.filter(only_audio=True).order_by('abr').desc().first()
                if audio_stream:
                    print(json.dumps({"info": f"Adaptive + Audio merge: {adap_stream.resolution} + {audio_stream.abr}"}), file=sys.stderr)
                    try:
                        merge_video_audio(adap_stream, audio_stream)
                    except Exception as e:
                        # Fallback: download video only
                        print(json.dumps({"info": f"Merge gagal, fallback video-only: {str(e)[:60]}"}), file=sys.stderr)
                        try:
                            stream_url_to_stdout(adap_stream.url)
                        except Exception as e2:
                            tmp = download_to_file(adap_stream, '.mp4')
                            with open(tmp, 'rb') as f:
                                while True:
                                    chunk = f.read(65536)
                                    if not chunk:
                                        break
                                    sys.stdout.buffer.write(chunk)
                            os.unlink(tmp)
                else:
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
            print(json.dumps({"info": f"URL stream gagal, fallback download: {str(e)[:60]}"}), file=sys.stderr)
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
