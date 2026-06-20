import sys
import json
import traceback

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No URL provided"}))
        sys.exit(1)

    url = sys.argv[1]

    # Coba import pytubefix
    try:
        from pytubefix import YouTube
    except ImportError:
        # Fallback: coba pytube lama
        try:
            from pytube import YouTube
        except ImportError:
            print(json.dumps({"error": "pytubefix tidak terinstall. Jalankan: pip install pytubefix"}))
            sys.exit(1)

    try:
        # Coba berbagai client secara berurutan
        clients_to_try = ['WEB', 'ANDROID_VR', 'ANDROID', 'TV', 'WEB_CREATOR']
        yt = None
        last_error = None

        for client in clients_to_try:
            try:
                yt = YouTube(url, client=client)
                # Test akses title untuk validasi
                _ = yt.title
                break
            except Exception as e:
                last_error = str(e)
                continue

        if yt is None:
            # Fallback: tanpa parameter client
            try:
                yt = YouTube(url)
                _ = yt.title
            except Exception as e:
                print(json.dumps({"error": f"Semua client gagal: {last_error} | Fallback: {str(e)}"}))
                sys.exit(1)

        formats = []

        # 1. Progressive streams (Video + Audio combined)
        try:
            progressive = yt.streams.filter(progressive=True).order_by('resolution').desc()
            for s in progressive:
                formats.append({
                    "type": "video",
                    "quality": s.resolution or "SD",
                    "url": s.url,
                    "ext": s.subtype,
                    "hasAudio": True
                })
        except Exception as e:
            print(json.dumps({"error": f"Gagal ambil progressive streams: {str(e)}"}), file=sys.stderr)

        # 2. Audio only streams
        try:
            audio = yt.streams.filter(only_audio=True).order_by('abr').desc()
            if audio:
                best_audio = audio.first()
                formats.append({
                    "type": "audio",
                    "quality": "Audio",
                    "url": best_audio.url,
                    "ext": best_audio.subtype
                })
        except Exception as e:
            print(json.dumps({"error": f"Gagal ambil audio: {str(e)}"}), file=sys.stderr)

        # 3. Adaptive video (DASH) jika progressive kosong
        if len(formats) == 0 or (len(formats) == 1 and formats[0]["type"] == "audio"):
            try:
                adaptive_video = yt.streams.filter(only_video=True).order_by('resolution').desc()
                if adaptive_video:
                    for s in adaptive_video:
                        formats.append({
                            "type": "video",
                            "quality": s.resolution or "SD",
                            "url": s.url,
                            "ext": s.subtype,
                            "hasAudio": False
                        })
            except Exception as e:
                print(json.dumps({"error": f"Gagal ambil adaptive video: {str(e)}"}), file=sys.stderr)

        result = {
            "title": yt.title,
            "author": yt.author,
            "thumbnail": yt.thumbnail_url,
            "duration": yt.length,
            "formats": formats
        }

        print(json.dumps(result))
    except Exception as e:
        tb = traceback.format_exc()
        print(json.dumps({"error": f"{str(e)} | trace: {tb[:200]}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
