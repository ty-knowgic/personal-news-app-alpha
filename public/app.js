:root {
  --bg: #f5f7fb;
  --panel: #ffffff;
  --line: #dfe7f3;
  --text: #132238;
  --muted: #5f7185;
  --blue: #3867d6;
  --blue-soft: #eaf0ff;
  --shadow: 0 16px 32px rgba(22, 36, 63, 0.08);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', sans-serif;
  background: var(--bg);
  color: var(--text);
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 1;
  background: rgba(255,255,255,0.82);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line);
}

.brand-wrap {
  max-width: 1200px;
  margin: 0 auto;
  padding: 18px 24px;
  display: flex;
  align-items: center;
  gap: 14px;
}

.brand-mark {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-weight: 700;
  color: white;
  background: linear-gradient(135deg, #4d7df5, #1e3a8a);
}

.eyebrow {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

h1 {
  margin: 0;
  font-size: clamp(1.4rem, 2vw, 2rem);
}

.layout {
  max-width: 1200px;
  margin: 30px auto;
  padding: 0 20px;
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 24px;
}

.sidebar,
.content {
  min-width: 0;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: var(--shadow);
  padding: 20px;
}

.panel h2 {
  margin-top: 0;
  font-size: 1.1rem;
}

.panel label,
.panel input,
.panel select {
  display: block;
  width: 100%;
}

.panel input,
.panel select {
  margin: 8px 0 18px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 0.95rem;
}

.status {
  margin-bottom: 18px;
  color: var(--muted);
  font-size: 0.95rem;
}

.news-list {
  display: grid;
  gap: 18px;
}

.news-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: var(--shadow);
  padding: 22px;
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.pill {
  display: inline-flex;
  align-items: center;
  padding: 7px 10px;
  border-radius: 999px;
  background: var(--blue-soft);
  color: var(--blue);
  font-size: 0.76rem;
  font-weight: 600;
}

.news-card h3 {
  margin: 0 0 12px;
  font-size: 1.25rem;
  line-height: 1.5;
}

.summary {
  margin: 0 0 12px;
  color: #1c2d40;
  line-height: 1.6;
}

.meta-line {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  color: var(--muted);
  font-size: 0.85rem;
  margin-bottom: 12px;
}

.hashtags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.hashtag {
  color: var(--blue);
  background: #edf4ff;
  border-radius: 999px;
  padding: 7px 10px;
  font-size: 0.8rem;
  font-weight: 600;
}

.link {
  color: var(--blue);
  text-decoration: none;
  font-weight: 600;
}

.link:hover {
  text-decoration: underline;
}

.empty-state {
  padding: 40px 20px;
  text-align: center;
  border: 1px dashed var(--line);
  border-radius: 18px;
  color: var(--muted);
  background: #fbfcff;
}

@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
