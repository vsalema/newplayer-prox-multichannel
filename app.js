(function () {
  const DEFAULT_POLL_MS = 15000;
  const JITTER_MS = 3000;
  const RETRY_BASE_MS = 3000;
  const RETRY_MAX_MS = 20000;
  const HLS_CONFIG = { maxBufferLength: 30 };

  const qs = new URLSearchParams(window.location.search);
  const channel = (qs.get("channel") || "latest").trim().toLowerCase();
  const pollMs = Math.max(3000, Number(qs.get("pollMs") || DEFAULT_POLL_MS));

  const hostEl = document.getElementById("player");
  if (!hostEl) {
    console.error("[player] Aucun conteneur vidéo trouvé (#player).");
    return;
  }

  class ChannelPlayer {
    constructor(host, channel) {
      this.host = host;
      this.video = host.querySelector("video") || this._injectVideo(host);
      this.channel = channel;
      this.jsonUrl = `data/${channel}.json`;
      this.hls = null;
      this.currentUrl = null;
      this.retryMs = RETRY_BASE_MS;
      this.stopped = false;
      this.loop();
    }

    _injectVideo(host) {
      const v = document.createElement("video");
      v.setAttribute("controls", "true");
      v.setAttribute("playsinline", "true");
      v.setAttribute("autoplay", "true");
      v.style.width = "100%";
      v.style.height = "100%";
      host.appendChild(v);
      return v;
    }

    async loop() {
      while (!this.stopped) {
        const startAt = Date.now();
        try {
          const next = await this.fetchLatest();
          if (next && next !== this.currentUrl) {
            await this.setSource(next);
            this.currentUrl = next;
          }
          this.retryMs = RETRY_BASE_MS;
        } catch (err) {
          console.warn(`[poll:${this.channel}]`, err?.message || err);
          await this.sleep(this.retryMs + Math.random() * 500);
          this.retryMs = Math.min(RETRY_MAX_MS, Math.floor(this.retryMs * 1.7));
          continue;
        }
        const elapsed = Date.now() - startAt;
        const nextDelay = Math.max(500, pollMs + Math.floor(Math.random() * JITTER_MS) - elapsed);
        await this.sleep(nextDelay);
      }
    }

    async fetchLatest() {
      const res = await fetch(this.jsonUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status} sur ${this.jsonUrl}`);
      const data = await res.json();
      const url = String(data?.m3u8 || "").trim();
      if (!url) throw new Error("Champ m3u8 vide dans le JSON.");
      return url;
    }

    async setSource(url) {
      if (window.Hls && window.Hls.isSupported()) {
        if (!this.hls) this.hls = new Hls(HLS_CONFIG);
        try { this.hls.detachMedia(); } catch {}
        this.hls.loadSource(url);
        this.hls.attachMedia(this.video);
        this.hls.on(Hls.Events.MANIFEST_PARSED, () => this.safePlay());
        this.hls.on(Hls.Events.ERROR, (evt, data) => {
          console.warn("[hls:error]", data?.type, data?.details);
        });
      } else if (this.video.canPlayType("application/vnd.apple.mpegurl")) {
        this.video.src = url;
        this.video.addEventListener("loadedmetadata", () => this.safePlay(), { once: true });
      } else {
        throw new Error("HLS non supporté.");
      }
    }

    async safePlay() {
      try { await this.video.play(); } catch (e) { console.debug("Autoplay bloqué", e?.message); }
    }
    sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  }

  new ChannelPlayer(hostEl, channel);
})();