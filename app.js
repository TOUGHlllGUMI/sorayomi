(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const STALE_MS = 10 * 60 * 1000;
  const FALLBACK = { name: '東京', admin1: '東京都', country: '日本', lat: 35.6895, lon: 139.6917 };

  // ---------- 保存 ----------
  const store = {
    get(key, def) {
      try {
        const v = localStorage.getItem('sorayomi:' + key);
        return v == null ? def : JSON.parse(v);
      } catch { return def; }
    },
    set(key, value) {
      try { localStorage.setItem('sorayomi:' + key, JSON.stringify(value)); } catch { /* 保存できなくても動く */ }
    },
  };

  // ---------- 天気コード ----------
  // WMO weather code → [日本語, 種類]
  const WMO = {
    0: ['快晴', 'clear'], 1: ['晴れ', 'clear'], 2: ['晴れ時々くもり', 'partly'], 3: ['くもり', 'overcast'],
    45: ['霧', 'fog'], 48: ['霧', 'fog'],
    51: ['弱い霧雨', 'drizzle'], 53: ['霧雨', 'drizzle'], 55: ['強い霧雨', 'drizzle'],
    56: ['冷たい霧雨', 'sleet'], 57: ['冷たい霧雨', 'sleet'],
    61: ['小雨', 'rain'], 63: ['雨', 'rain'], 65: ['大雨', 'rain'],
    66: ['冷たい雨', 'sleet'], 67: ['冷たい雨', 'sleet'],
    71: ['小雪', 'snow'], 73: ['雪', 'snow'], 75: ['大雪', 'snow'], 77: ['霧雪', 'snow'],
    80: ['にわか雨', 'showers'], 81: ['にわか雨', 'showers'], 82: ['激しいにわか雨', 'showers'],
    85: ['にわか雪', 'snowshowers'], 86: ['激しいにわか雪', 'snowshowers'],
    95: ['雷雨', 'thunder'], 96: ['雷雨(ひょう)', 'thunderrain'], 99: ['雷雨(ひょう)', 'thunderrain'],
  };
  const kindOf = (code) => (WMO[code] || [null, 'na'])[1];
  const labelOf = (code) => (WMO[code] || ['--'])[0];
  const RAINY = new Set(['drizzle', 'sleet', 'rain', 'showers', 'thunder', 'thunderrain']);

  function iconOf(code, isDay = true) {
    const dn = isDay ? 'day' : 'night';
    switch (kindOf(code)) {
      case 'clear': return `clear-${dn}`;
      case 'partly': return `partly-cloudy-${dn}`;
      case 'overcast': return 'overcast';
      case 'fog': return `fog-${dn}`;
      case 'drizzle': return 'drizzle';
      case 'sleet': return 'sleet';
      case 'rain': return 'rain';
      case 'showers': return `partly-cloudy-${dn}-rain`;
      case 'snow': return 'snow';
      case 'snowshowers': return `partly-cloudy-${dn}-snow`;
      case 'thunder': return `thunderstorms-${dn}`;
      case 'thunderrain': return 'thunderstorms-rain';
      default: return 'not-available';
    }
  }
  const iconSrc = (name) => `icons/weather/${name}.svg`;

  function themeOf(code, isDay) {
    const k = kindOf(code);
    if (k === 'thunder' || k === 'thunderrain') return 'storm';
    if (k === 'snow' || k === 'snowshowers') return isDay ? 'snowy' : 'night-cloudy';
    if (RAINY.has(k)) return isDay ? 'rainy' : 'night-cloudy';
    if (k === 'overcast' || k === 'fog') return isDay ? 'cloudy' : 'night-cloudy';
    return isDay ? 'sunny' : 'night';
  }

  // ---------- 小さな道具 ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r0 = (n) => Math.round(n);
  const WEEK = '日月火水木金土';
  const DIRS = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
  const dirName = (deg) => DIRS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  const hourOf = (iso) => Number(iso.slice(11, 13));
  const hm = (iso) => `${hourOf(iso)}:${iso.slice(14, 16)}`;
  function dateOf(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function uvLabel(uv) {
    if (uv < 3) return '弱い';
    if (uv < 6) return '中くらい';
    if (uv < 8) return '強い';
    if (uv < 11) return '非常に強い';
    return '極端に強い';
  }

  // 気温 → 色(バーの色)
  const TEMP_STOPS = [[-5, [142, 197, 255]], [8, [126, 224, 214]], [18, [190, 230, 120]], [25, [255, 211, 110]], [33, [255, 128, 88]]];
  function tempColor(t) {
    if (t <= TEMP_STOPS[0][0]) return `rgb(${TEMP_STOPS[0][1]})`;
    for (let i = 1; i < TEMP_STOPS.length; i++) {
      const [t1, c1] = TEMP_STOPS[i];
      if (t <= t1) {
        const [t0, c0] = TEMP_STOPS[i - 1];
        const f = (t - t0) / (t1 - t0);
        return `rgb(${c0.map((v, j) => r0(v + (c1[j] - v) * f)).join(',')})`;
      }
    }
    return `rgb(${TEMP_STOPS[TEMP_STOPS.length - 1][1]})`;
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  // ---------- 通信 ----------
  async function fetchWeather(lat, lon) {
    const p = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      timezone: 'auto',
      forecast_days: '8',
      wind_speed_unit: 'ms',
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day',
      hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset,wind_speed_10m_max',
    });
    const res = await fetch('https://api.open-meteo.com/v1/forecast?' + p);
    if (!res.ok) throw new Error('weather ' + res.status);
    return res.json();
  }

  const SUFFIXES = ['市', '区', '町', '村', '都', '府', '県'];
  async function searchPlaces(q) {
    // 「札幌」「大阪」のように「市」が無いと見つからない地名があるので、日本語なら語尾をつけた形でもさがす
    const names = [q];
    if (/[぀-ヿ一-鿿]/.test(q) && !SUFFIXES.some((s) => q.endsWith(s))) {
      SUFFIXES.forEach((s) => names.push(q + s));
    }
    const lists = await Promise.all(names.map((name) => {
      const p = new URLSearchParams({ name, count: '10', language: 'ja', format: 'json' });
      return fetch('https://geocoding-api.open-meteo.com/v1/search?' + p)
        .then((r) => (r.ok ? r.json() : {}))
        .then((d) => d.results || [])
        .catch(() => []);
    }));
    const seen = new Map();
    lists.flat().forEach((r) => { if (!seen.has(r.id)) seen.set(r.id, r); });
    return [...seen.values()]
      .sort((a, b) => (b.population || 0) - (a.population || 0))
      .slice(0, 12)
      .map((r) => ({
        id: r.id,
        name: r.name,
        admin1: r.admin1 && r.admin1 !== r.name ? r.admin1 : '',
        country: r.country || '',
        lat: r.latitude,
        lon: r.longitude,
      }));
  }

  async function reverseName(lat, lon) {
    try {
      const p = new URLSearchParams({ latitude: lat, longitude: lon, localityLanguage: 'ja' });
      const res = await fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?' + p);
      if (!res.ok) throw new Error();
      const d = await res.json();
      const name = d.locality || d.city || d.principalSubdivision || '';
      const admin1 = d.principalSubdivision && d.principalSubdivision !== name ? d.principalSubdivision : '';
      return { name: name || '現在地', admin1, country: d.countryName || '' };
    } catch {
      return { name: '現在地', admin1: '', country: '' };
    }
  }

  // ---------- 状態 ----------
  let place = null;      // いま表示している場所
  let lastData = null;
  let lastAt = 0;
  let loadSeq = 0;

  const placeKey = (p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  const subText = (p) => [p.gps ? '現在地' : '', p.admin1, p.country && p.country !== '日本' ? p.country : ''].filter(Boolean).join(' ・ ');

  function showPlace(p) {
    $('#placeName').textContent = p.name;
    $('#placeSub').textContent = subText(p);
    document.title = `${p.name}の天気 - そらよみ`;
    updateFavBtn();
  }

  async function load(p, { quiet = false } = {}) {
    const seq = ++loadSeq;
    place = p;
    store.set('place', p);
    showPlace(p);

    const cache = store.get('cache', {});
    const hit = cache[placeKey(p)];
    if (hit && seq === loadSeq) {
      render(hit.data, hit.at);
    } else {
      document.body.classList.add('loading');
    }

    $('#refreshBtn').classList.add('spin');
    try {
      const data = await fetchWeather(p.lat, p.lon);
      if (seq !== loadSeq) return;  // 待っている間に別の場所へ切りかわった
      const at = Date.now();
      render(data, at);
      const next = store.get('cache', {});
      next[placeKey(p)] = { at, data };
      // 古いものから捨てて、8か所までにする
      const keys = Object.keys(next).sort((a, b) => next[b].at - next[a].at);
      keys.slice(8).forEach((k) => delete next[k]);
      store.set('cache', next);
    } catch (err) {
      if (seq !== loadSeq) return;
      if (!quiet) toast(hit ? '通信できないので、前に読みこんだ天気を出しています' : '天気を読みこめませんでした。通信を確かめて、更新ボタンを押してください');
      if (!hit) renderError();
    } finally {
      if (seq === loadSeq) {
        $('#refreshBtn').classList.remove('spin');
        document.body.classList.remove('loading');
      }
    }
  }

  function useGPS({ fromStart = false } = {}) {
    if (!('geolocation' in navigator)) {
      gpsFailed(fromStart, 'この端末では現在地が使えません');
      return;
    }
    $('#refreshBtn').classList.add('spin');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const seq = loadSeq;
      const n = await reverseName(lat, lon);
      if (seq !== loadSeq) return; // 名前を待つあいだに別の場所が選ばれた
      load({ gps: true, lat, lon, ...n });
    }, (err) => {
      $('#refreshBtn').classList.remove('spin');
      gpsFailed(fromStart, err.code === 1
        ? '位置情報が許可されていません。地名で検索できます'
        : '現在地を取得できませんでした。地名で検索できます');
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60 * 1000 });
  }

  function gpsFailed(fromStart, msg) {
    toast(msg);
    if (fromStart && !lastData) load(FALLBACK);
  }

  // ---------- 描画 ----------
  function render(d, at) {
    lastData = d;
    lastAt = at;
    const c = d.current;
    const daily = d.daily;
    const isDay = c.is_day === 1;

    document.documentElement.dataset.theme = themeOf(c.weather_code, isDay);
    const sky = getComputedStyle(document.documentElement).getPropertyValue('--sky-a').trim();
    document.querySelector('meta[name="theme-color"]').setAttribute('content', sky);

    // いま
    $('#nowIcon').src = iconSrc(iconOf(c.weather_code, isDay));
    $('#nowIcon').alt = labelOf(c.weather_code);
    $('#nowTemp').textContent = r0(c.temperature_2m);
    $('#nowLabel').textContent = labelOf(c.weather_code);
    $('#nowRange').textContent = `最高 ${r0(daily.temperature_2m_max[0])}° / 最低 ${r0(daily.temperature_2m_min[0])}° ・ 体感 ${r0(c.apparent_temperature)}°`;

    const start = hourIndex(d);
    renderAdvice(d, start);
    renderHourly(d, start);
    renderWeek(d);
    renderDetails(d);

    const t = new Date(at);
    $('#updated').textContent = `${t.getMonth() + 1}/${t.getDate()} ${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')} 更新`;
  }

  function renderError() {
    $('#advice').innerHTML = `<div class="tip"><img src="${iconSrc('not-available')}" alt=""><div><div class="tip-title">天気を読みこめませんでした</div><div class="tip-body">通信を確かめて、右上の更新ボタンを押してください。</div></div></div>`;
  }

  // 1時間ごとの配列で「いま」の位置
  function hourIndex(d) {
    const key = d.current.time.slice(0, 13) + ':00';
    const times = d.hourly.time;
    const i = times.indexOf(key);
    if (i >= 0) return i;
    const j = times.findIndex((t) => t >= key);
    return j >= 0 ? j : 0;
  }

  function renderAdvice(d, start) {
    const h = d.hourly;
    const daily = d.daily;
    const nowHour = hourOf(d.current.time);
    const forTomorrow = nowHour >= 18;
    const di = forTomorrow ? 1 : 0;

    // 対象の時間帯: 今日なら今から12時間、明日なら明日の6時〜21時
    let from, to;
    if (forTomorrow) {
      const day = daily.time[1];
      from = h.time.indexOf(`${day}T06:00`);
      to = h.time.indexOf(`${day}T21:00`);
      if (from < 0 || to < 0) { from = start; to = start + 12; }
    } else {
      from = start;
      to = Math.min(start + 12, h.time.length - 1);
    }
    let maxPop = 0;
    let firstRain = -1;
    for (let i = from; i <= to; i++) {
      const pop = h.precipitation_probability[i] ?? 0;
      maxPop = Math.max(maxPop, pop);
      if (firstRain < 0 && (pop >= 50 || RAINY.has(kindOf(h.weather_code[i])) && pop >= 30)) firstRain = i;
    }
    const snowy = (() => {
      for (let i = from; i <= to; i++) {
        const k = kindOf(h.weather_code[i]);
        if (k === 'snow' || k === 'snowshowers') return true;
      }
      return false;
    })();
    const rainingNow = !forTomorrow && RAINY.has(kindOf(d.current.weather_code));
    const fall = snowy ? '雪' : '雨';

    let umbTitle, umbBody;
    if (rainingNow) {
      umbTitle = '傘を持っていこう';
      umbBody = `いま${fall}が降っています。`;
    } else if (maxPop >= 60) {
      umbTitle = '傘を持っていこう';
      umbBody = firstRain >= 0 ? `${hourOf(h.time[firstRain])}時ごろから${fall}になりそう(降水確率 ${maxPop}%)。` : `降水確率 ${maxPop}%。`;
    } else if (maxPop >= 30) {
      umbTitle = '折りたたみ傘があると安心';
      umbBody = firstRain >= 0
        ? `${hourOf(h.time[firstRain])}時ごろに${fall}が降るかも(降水確率 ${maxPop}%)。`
        : `ところにより${fall}が降るかも(降水確率 ${maxPop}%)。`;
    } else {
      umbTitle = '傘はいらなさそう';
      umbBody = maxPop < 10 ? `${fall}の心配はなさそう。` : `降水確率は高くても ${maxPop}%。`;
    }

    const max = daily.temperature_2m_max[di];
    const min = daily.temperature_2m_min[di];
    let clothTitle;
    if (max >= 30) clothTitle = '半袖で。暑さに気をつけて';
    else if (max >= 25) clothTitle = '半袖がちょうどいい';
    else if (max >= 21) clothTitle = '長袖シャツか、薄い長袖';
    else if (max >= 16) clothTitle = 'カーディガンや薄い上着を';
    else if (max >= 11) clothTitle = 'セーターや、しっかりした上着を';
    else if (max >= 6) clothTitle = 'コートが必要';
    else clothTitle = '厚いコートに、マフラーや手袋も';

    const notes = [];
    if (max - min >= 8) notes.push(`朝と昼の差が ${r0(max - min)}°。脱ぎ着しやすい服がおすすめ。`);
    if ((daily.uv_index_max[di] ?? 0) >= 6) notes.push('日ざしが強いので、帽子や日焼け止めを。');
    if ((daily.wind_speed_10m_max[di] ?? 0) >= 10) notes.push('風が強いので、傘や自転車に注意。');
    if (!notes.length) {
      if (max >= 27) notes.push('汗をかきやすいので、水分補給を忘れずに。');
      else if (max < 10) notes.push('朝と夜はとくに冷えこみます。');
      else if (max >= 18 && maxPop < 30) notes.push('過ごしやすい一日になりそう。');
      else notes.push(`日中は ${r0(max)}° くらい。`);
    }

    const umbIcon = maxPop >= 30 || rainingNow ? 'umbrella' : 'clear-day';
    $('#advice').innerHTML = `
      <div class="advice-when">${forTomorrow ? '明日のひとこと' : '今日のひとこと'}</div>
      <div class="tip">
        <img src="${iconSrc(umbIcon)}" alt="">
        <div><div class="tip-title">${esc(umbTitle)}</div><div class="tip-body">${esc(umbBody)}</div></div>
      </div>
      <div class="tip">
        <img src="${iconSrc('thermometer')}" alt="">
        <div><div class="tip-title">${esc(clothTitle)}</div><div class="tip-body">${esc(notes.join(''))}</div></div>
      </div>`;
  }

  function renderHourly(d, start) {
    const h = d.hourly;
    const end = Math.min(start + 25, h.time.length);
    const parts = [];
    for (let i = start; i < end; i++) {
      const hr = hourOf(h.time[i]);
      const pop = h.precipitation_probability[i] ?? 0;
      const isNow = i === start;
      const newDay = !isNow && hr === 0;
      const day = h.time[i].slice(0, 10);
      const dayTag = day === d.daily.time[1] ? '明日' : `${dateOf(day).getDate()}日`;
      parts.push(`
        <div class="hour${isNow ? ' now-hour' : ''}${newDay ? ' newday' : ''}"${newDay ? ` data-day="${dayTag}"` : ''}>
          <span class="hour-time">${isNow ? '今' : hr + '時'}</span>
          <img src="${iconSrc(iconOf(h.weather_code[i], h.is_day[i] === 1))}" alt="${esc(labelOf(h.weather_code[i]))}" loading="lazy">
          <span class="hour-temp">${r0(h.temperature_2m[i])}°</span>
          <span class="hour-pop${pop < 20 ? ' dim' : ''}">${pop}%</span>
        </div>`);
    }
    const el = $('#hourly');
    el.innerHTML = parts.join('');
    el.scrollLeft = 0;
  }

  function renderWeek(d) {
    const dl = d.daily;
    const n = Math.min(7, dl.time.length);
    const lo = Math.min(...dl.temperature_2m_min.slice(0, n));
    const hi = Math.max(...dl.temperature_2m_max.slice(0, n));
    const span = Math.max(1, hi - lo);
    const rows = [];
    for (let i = 0; i < n; i++) {
      const dt = dateOf(dl.time[i]);
      const name = i === 0 ? '今日' : i === 1 ? '明日' : `${WEEK[dt.getDay()]}曜`;
      const min = dl.temperature_2m_min[i];
      const max = dl.temperature_2m_max[i];
      const pop = dl.precipitation_probability_max[i] ?? 0;
      const left = ((min - lo) / span) * 100;
      const width = Math.max(4, ((max - min) / span) * 100);
      rows.push(`
        <li class="day">
          <span class="day-name">${name}<small>${dt.getMonth() + 1}/${dt.getDate()}</small></span>
          <img src="${iconSrc(iconOf(dl.weather_code[i], true))}" alt="${esc(labelOf(dl.weather_code[i]))}" title="${esc(labelOf(dl.weather_code[i]))}">
          <span class="day-pop${pop < 20 ? ' dim' : ''}">${pop}%</span>
          <span class="day-range">
            <span class="day-min">${r0(min)}°</span>
            <span class="bar"><i style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%;background:linear-gradient(90deg,${tempColor(min)},${tempColor(max)})"></i></span>
            <span class="day-max">${r0(max)}°</span>
          </span>
        </li>`);
    }
    $('#week').innerHTML = rows.join('');
  }

  function renderDetails(d) {
    const c = d.current;
    const dl = d.daily;
    const uv = dl.uv_index_max[0] ?? 0;
    const feel = c.apparent_temperature - c.temperature_2m;
    const hum = c.relative_humidity_2m;
    const wind = c.wind_speed_10m;
    const windNote = wind < 2 ? 'ほぼ無風' : wind < 5 ? 'そよ風' : wind < 8 ? 'やや強い' : wind < 11 ? '強い' : 'とても強い';
    const tiles = [
      { icon: 'thermometer', head: '体感温度', value: `${r0(c.apparent_temperature)}°`,
        note: Math.abs(feel) < 1.5 ? '気温とほぼ同じ' : feel > 0 ? '気温より暑く感じる' : '気温より寒く感じる' },
      { icon: 'humidity', head: '湿度', value: `${hum}<small>%</small>`,
        note: hum < 40 ? '乾燥ぎみ' : hum < 70 ? 'ちょうどいい' : 'じめじめ' },
      { icon: 'wind', head: '風', value: `${wind.toFixed(1)}<small>m/s</small>`,
        note: `${dirName(c.wind_direction_10m)}の風 ・ ${windNote}` },
      { icon: 'uv-index', head: '紫外線(今日の最大)', value: `${uv.toFixed(0)}`, note: uvLabel(uv) },
      { icon: 'sunrise', head: '日の出', value: hm(dl.sunrise[0]), note: `明日 ${hm(dl.sunrise[1])}` },
      { icon: 'sunset', head: '日の入り', value: hm(dl.sunset[0]), note: `明日 ${hm(dl.sunset[1])}` },
    ];
    $('#details').innerHTML = tiles.map((t) => `
      <div class="card tile">
        <div class="tile-head"><img src="${iconSrc(t.icon)}" alt="">${t.head}</div>
        <div class="tile-value">${t.value}</div>
        <div class="tile-note">${esc(t.note)}</div>
      </div>`).join('');
  }

  // ---------- お気に入り ----------
  const favs = () => store.get('favs', []);
  const sameSpot = (a, b) => a && b && Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;
  const isFav = (p) => favs().some((f) => sameSpot(f, p));

  function updateFavBtn() {
    const on = place && isFav(place);
    const btn = $('#favBtn');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? 'お気に入りから外す' : 'お気に入りに追加');
  }

  function toggleFav() {
    if (!place) return;
    let list = favs();
    if (isFav(place)) {
      list = list.filter((f) => !sameSpot(f, place));
      toast(`${place.name}をお気に入りから外しました`);
    } else {
      const { name, admin1, country, lat, lon } = place;
      list.push({ name, admin1, country, lat, lon });
      toast(`${place.name}をお気に入りに追加しました`);
    }
    store.set('favs', list);
    updateFavBtn();
  }

  // ---------- 検索シート ----------
  const sheet = $('#sheet');
  let searchTimer = 0;
  let searchSeq = 0;

  function openSheet() {
    $('#searchInput').value = '';
    $('#results').innerHTML = '';
    renderFavList();
    sheet.showModal();
    // スマホでいきなりキーボードが出ると、お気に入りが隠れるので広い画面のときだけ
    if (matchMedia('(min-width: 600px)').matches) $('#searchInput').focus();
  }

  function renderFavList() {
    const list = favs();
    $('#favTitle').hidden = list.length === 0;
    $('#favList').innerHTML = list.map((f, i) => `
      <div class="row" data-fav="${i}" role="button" tabindex="0">
        <div class="row-main"><div class="row-name">${esc(f.name)}</div><div class="row-sub">${esc(subText(f))}</div></div>
        <button class="row-del" type="button" data-del="${i}" aria-label="${esc(f.name)}をお気に入りから外す">×</button>
      </div>`).join('');
  }

  function renderResults(items, q) {
    const el = $('#results');
    if (!q) { el.innerHTML = ''; return; }
    if (!items.length) {
      el.innerHTML = `<div class="list-note">「${esc(q)}」は見つかりませんでした。ひらがなより漢字のほうが見つかりやすいです。</div>`;
      return;
    }
    el.innerHTML = '<h3 class="list-title">検索結果</h3>' + items.map((p, i) => `
      <button class="row" type="button" data-result="${i}">
        <div class="row-main"><div class="row-name">${esc(p.name)}</div><div class="row-sub">${esc([p.admin1, p.country !== '日本' ? p.country : ''].filter(Boolean).join(' ・ '))}</div></div>
      </button>`).join('');
    el._items = items;
  }

  async function runSearch(q) {
    const seq = ++searchSeq;
    if (!q) { renderResults([], ''); return; }
    $('#results').innerHTML = '<div class="list-note">さがしています…</div>';
    const items = await searchPlaces(q);
    if (seq !== searchSeq) return;
    renderResults(items, q);
  }

  function choose(p) {
    sheet.close();
    load(p);
  }

  // ---------- イベント ----------
  $('#placeBtn').addEventListener('click', openSheet);
  $('#favBtn').addEventListener('click', toggleFav);
  $('#refreshBtn').addEventListener('click', () => {
    if (!place) return;
    if (place.gps) useGPS(); else load(place);
  });
  $('#sheetClose').addEventListener('click', () => sheet.close());
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
  $('#gpsBtn').addEventListener('click', () => { sheet.close(); useGPS(); });

  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    searchTimer = setTimeout(() => runSearch(q), 350);
  });
  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(searchTimer);
    runSearch($('#searchInput').value.trim());
  });

  $('#results').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-result]');
    if (!btn) return;
    const p = $('#results')._items[Number(btn.dataset.result)];
    if (p) choose(p);
  });

  function onFavList(e) {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const list = favs();
      list.splice(Number(del.dataset.del), 1);
      store.set('favs', list);
      renderFavList();
      updateFavBtn();
      return;
    }
    const row = e.target.closest('[data-fav]');
    if (!row) return;
    const f = favs()[Number(row.dataset.fav)];
    if (f) choose(f);
  }
  $('#favList').addEventListener('click', onFavList);
  $('#favList').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-fav]')) { e.preventDefault(); onFavList(e); }
  });

  // 開きっぱなしで時間がたったら、戻ってきたときに読みなおす
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && place && Date.now() - lastAt > STALE_MS) {
      load(place, { quiet: true });
    }
  });

  // ---------- 起動 ----------
  const saved = store.get('place', null);
  if (!saved) {
    useGPS({ fromStart: true });
  } else if (saved.gps) {
    load(saved, { quiet: true });   // まず前回の現在地で出しておき、
    useGPS();                        // 新しい現在地で上書きする
  } else {
    load(saved);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // 動作確認用
  window.__sorayomi = { load, render, searchPlaces, iconOf, themeOf, get data() { return lastData; } };
})();
