// === FIREBASE AUTHENTICATION SETUP ===
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js';

// ─── Threshold constants ───
const MIN_DISTANCE  = 3;      // meters
const MIN_TIME      = 1;      // seconds
const MIN_SPEED_KMH = 3;      // km/h
const MIN_SPEED     = MIN_SPEED_KMH / 3.6; // ≈0.83 m/s
const MAX_ACCURACY  = 50;     // meters

// ─── Firebase config ───
const firebaseConfig = {
  apiKey: "AIzaSyCX4vYmL8LIygOgmoE0B9c7FlL2vHJPJmM",
  authDomain: "runtracker-f372e.firebaseapp.com",
  projectId: "runtracker-f372e",
  storageBucket: "runtracker-f372e.firebasestorage.app",
  messagingSenderId: "144324009143",
  appId: "1:144324009143:web:6cffe5b2192f6f9aee4132"
};
const fbApp = initializeApp(firebaseConfig);
const auth  = getAuth(fbApp);
onAuthStateChanged(auth, user => {
  if (!user) window.location.href = 'settings.html';
});
window.doSignOut = () => signOut(auth).then(() => window.location.href = 'settings.html');

// === SCREEN WAKE LOCK LOGIC ===
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => console.log('Screen Wake Lock released'));
      console.log('Screen Wake Lock acquired');
    }
  } catch (err) {
    console.error('Wake Lock request failed:', err);
  }
}
async function releaseWakeLock() {
  if (wakeLock) {
    await wakeLock.release();
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', async () => {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    await requestWakeLock();
  }
});

// === SERVICE WORKER REGISTRATION ===
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' })
    .then(reg => {
      reg.onupdatefound = () => {
        const newWorker = reg.installing;
        newWorker.onstatechange = () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            const banner = document.createElement('div');
            banner.innerHTML = `
              <div style="
                position: fixed;
                bottom: 70px;
                left: 50%;
                transform: translateX(-50%);
                background: #2575fc;
                color: white;
                padding: 12px 20px;
                border-radius: 30px;
                font-weight: 600;
                box-shadow: 0 4px 10px rgba(0,0,0,0.2);
                z-index: 1000;
              ">
                🔄 New version available. <span style="text-decoration: underline; cursor: pointer;" onclick="location.reload()">Update</span>
              </div>`;
            document.body.appendChild(banner);
          }
        };
      };
    })
    .catch(err => console.error("Service worker registration failed:", err));
}

document.addEventListener('DOMContentLoaded', () => {
  // === INDEX PAGE LOGIC ===
  if (document.getElementById('startStopBtn')) {
    let selectedExerciseType = null,
        currentWeather      = null,
        running              = false,
        timerInterval,
        startTime,
        elapsedTime         = 0,
        positions           = [],
        watchId,
        map, polyline,
        totalDistance       = 0,
        speedSamples        = [],
        maxSpeed            = 0,
        minSpeed            = Infinity;

    const distanceEl     = document.getElementById('distance');
    const currentSpeedEl = document.getElementById('currentSpeed');
    const timerEl        = document.getElementById('timer');
    const btn            = document.getElementById('startStopBtn');

    document.getElementById('exerciseDropdown')
      .addEventListener('change', e => selectedExerciseType = e.target.value);

    function fetchWeather(lat, lon) {
      if (!lat||!lon||isNaN(lat)||isNaN(lon)) return;
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`)
        .then(res => res.json())
        .then(data => {
          if (data.current_weather) {
            const code = data.current_weather.weathercode;
            const desc = code === 0               ? "Clear"
                       : [1,2,3].includes(code) ? "Partly Cloudy"
                       : [45,48].includes(code)  ? "Fog"
                       : [51,53,55].includes(code)? "Drizzle"
                       : [61,63,65].includes(code)? "Rain"
                       : [66,67].includes(code)   ? "Freezing Rain"
                       : [71,73,75].includes(code)? "Snow"
                       : code === 80               ? "Rain Showers"
                       : code === 95               ? "Thunderstorm"
                       : "Unknown";
            currentWeather = {
              temperature: data.current_weather.temperature,
              description: desc
            };
          }
        })
        .catch(err => console.error("Weather fetch error", err));
    }

    function updateTimer() {
      elapsedTime = Math.floor((Date.now() - startTime) / 1000);
      const hrs  = String(Math.floor(elapsedTime/3600)).padStart(2,'0'),
            mins = String(Math.floor((elapsedTime%3600)/60)).padStart(2,'0'),
            secs = String(elapsedTime%60).padStart(2,'0');
      timerEl.textContent = `${hrs}:${mins}:${secs}`;
    }

    function computeDistance(lat1, lon1, lat2, lon2) {
      const R  = 6371e3,
            φ1 = lat1 * Math.PI/180,
            φ2 = lat2 * Math.PI/180,
            Δφ = (lat2 - lat1)*Math.PI/180,
            Δλ = (lon2 - lon1)*Math.PI/180,
            a  = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2,
            c  = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    async function startRunning() {
      if (!selectedExerciseType) {
        alert("Please select an exercise type before starting.");
        return;
      }
    
      // 1. Hide the header for full-screen timer/map
      document.querySelector('header').style.display = 'none';
    
      // 2. Acquire wake lock
      await requestWakeLock();
    
      // 3. Initialize run state
      running       = true;
      startTime     = Date.now();
      elapsedTime   = 0;
      positions     = [];
      totalDistance = 0;
      maxSpeed      = 0;
      minSpeed      = Infinity;
      speedSamples  = [];
    
      // 4. Start timer display
      timerInterval = setInterval(updateTimer, 1000);
    
      // 5. Switch button to STOP and color it red
      btn.textContent              = "Stop";
      btn.style.backgroundColor    = "red";
    
      // 6. Begin geolocation tracking & initial weather fetch
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          p => fetchWeather(p.coords.latitude, p.coords.longitude)
        );
        watchId = navigator.geolocation.watchPosition(
          positionSuccess,
          positionError,
          { enableHighAccuracy: true }
        );
      } else {
        alert("Geolocation not supported.");
      }
    }

    async function stopRunning() {
      // 1. Flip running flag & clear the timer/watch
      running = false;
      clearInterval(timerInterval);
      navigator.geolocation.clearWatch(watchId);
    
      // 2. Show the header again
      document.querySelector('header').style.display = '';
    
      // 3. Reset button back to Start (and clear inline red color)
      btn.textContent           = "Start";
      btn.style.backgroundColor = "";
    
      // 4. Release wake lock
      await releaseWakeLock();
    
      // 5. Build the exercise record
      const avg = elapsedTime > 0 ? (totalDistance/elapsedTime)*3.6 : 0;
      const ex  = {
        timestamp:    startTime,
        date:         new Date(startTime).toLocaleString(),
        duration:     elapsedTime,
        distance:     (totalDistance/1000).toFixed(2),
        avgSpeed:     avg.toFixed(2),
        maxSpeed:     (maxSpeed*3.6).toFixed(2),
        minSpeed:     ((minSpeed===Infinity?0:minSpeed)*3.6).toFixed(2),
        positions,
        exerciseType: selectedExerciseType,
        weather:      currentWeather
      };
    
      // 6. Save it
      const all = JSON.parse(localStorage.getItem('exercises') || '[]');
      all.push(ex);
      localStorage.setItem('exercises', JSON.stringify(all));
    
      // 7. Instead of alert(), show our custom modal
      document.getElementById('savedModal').style.display = 'flex';
    }

    function positionSuccess(pos) {
      const { latitude, longitude, speed, accuracy } = pos.coords;
      const timestamp = pos.timestamp;
      if (isNaN(latitude)||isNaN(longitude)||accuracy>MAX_ACCURACY) return;

      if (positions.length===0) {
        positions.push({ coords:{latitude,longitude}, timestamp });
        polyline?.addLatLng([latitude, longitude]);
        map?.setView([latitude, longitude], 16);
        return;
      }

      const prev = positions[positions.length-1];
      const d    = computeDistance(prev.coords.latitude, prev.coords.longitude, latitude, longitude);
      const t    = (timestamp - prev.timestamp)/1000;
      if (d<MIN_DISTANCE||t<MIN_TIME) return;

      const rawSpeed = (speed!==null && !isNaN(speed)) ? speed : d/t;
      if (rawSpeed<MIN_SPEED) return;

      totalDistance += d;
      positions.push({ coords:{latitude,longitude}, timestamp });
      speedSamples.push(rawSpeed);
      if (speedSamples.length>5) speedSamples.shift();

      const sm = speedSamples.reduce((a,b)=>a+b,0)/speedSamples.length;
      maxSpeed = Math.max(maxSpeed, sm);
      minSpeed = Math.min(minSpeed, sm);

      polyline?.addLatLng([latitude, longitude]);
      map?.setView([latitude, longitude], 16);

      distanceEl.textContent     = (totalDistance/1000).toFixed(2);
      currentSpeedEl.textContent = (sm*3.6).toFixed(2);
    }

    function positionError(err) {
      console.warn(`ERROR(${err.code}): ${err.message}`);
    }

    btn.addEventListener('click', () => running ? stopRunning() : startRunning());

    window.onload = () => {
      map = L.map('map').setView([0,0],2);
      L.tileLayer('https://mt1.google.com/vt/lyrs=r&x={x}&y={y}&z={z}', {
        attribution:'© Google Maps', maxZoom:20
      }).addTo(map);
      polyline = L.polyline([], { color:'red', weight:5 }).addTo(map);
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(p => {
          const lat=p.coords.latitude, lng=p.coords.longitude;
          if (!isNaN(lat)&&!isNaN(lng)) {
            map.setView([lat,lng],16);
            L.marker([lat,lng]).addTo(map).bindPopup("You are here").openPopup();
          }
        });
      }
    };
  }

// === HISTORY PAGE LOGIC ===
if (document.getElementById('historyList')) {
  // 1. Load exercises & reverse so newest (last‐pushed) come first
  let exercises = JSON.parse(localStorage.getItem('exercises') || '[]')
    .reverse();

  const container = document.getElementById('historyList');

  // 2. Render cards
  function renderHistory() {
    container.innerHTML = '';
    exercises.forEach((ex, i) => {
      const card = document.createElement('div');
      card.className = 'exercise-card';
      const durationMin = (ex.duration / 60).toFixed(2);
      card.innerHTML = `
        <div class="card-header">
          <div class="card-date">${ex.date}</div>
          <div class="card-actions">
            <button class="map-btn" data-index="${i}" title="View Map">📍</button>
            <button class="delete-btn" data-index="${i}" title="Delete">🗑️</button>
          </div>
        </div>
        <div class="card-body">
          <p><strong>Duration:</strong> ${durationMin} min</p>
          <p><strong>Distance:</strong> ${ex.distance} km</p>
          <p><strong>Avg Speed:</strong> ${ex.avgSpeed} km/h</p>
          <p><strong>Max Speed:</strong> ${ex.maxSpeed} km/h</p>
          <p><strong>Min Speed:</strong> ${ex.minSpeed} km/h</p>
          <p><strong>Type:</strong> ${ex.exerciseType || 'N/A'}</p>
          <p><strong>Weather:</strong> ${
            ex.weather
              ? `${ex.weather.description}, ${ex.weather.temperature}°C`
              : 'N/A'
          }</p>
        </div>`;
      container.appendChild(card);
    });
  }

  renderHistory();

  // 3. Handle delete & map-btn clicks
  container.addEventListener('click', (e) => {
    if (e.target.matches('.delete-btn')) {
      const idx = Number(e.target.dataset.index);
      if (confirm('Delete this exercise?')) {
        exercises.splice(idx, 1);
        localStorage.setItem('exercises', JSON.stringify(exercises.reverse().reverse()));
        renderHistory();
      }
    } else if (e.target.matches('.map-btn')) {
      viewRoute(Number(e.target.dataset.index));
    }
  });
}

  // === VIEW ROUTE & CLOSE ===
  window.viewRoute = index => {
    const exercises = JSON.parse(localStorage.getItem('exercises')||'[]');
    const ex = exercises[index];
    if (!ex?.positions?.length) return alert("No route data available.");
    document.getElementById('routeView').style.display = 'block';
    const mapDiv = document.getElementById('map');
    mapDiv.innerHTML = '';
    if (mapDiv._leaflet_id) mapDiv._leaflet_id = null;
    const routeMap = L.map('map').setView([0,0],13);
    L.tileLayer('https://mt1.google.com/vt/lyrs=r&x={x}&y={y}&z={z}', {
      attribution:'© Google Maps', maxZoom:20
    }).addTo(routeMap);
    const latlngs = ex.positions.map(p=>[p.coords.latitude,p.coords.longitude]);
    L.polyline(latlngs,{color:'red'}).addTo(routeMap);
    L.marker(latlngs[0]).addTo(routeMap).bindPopup("Start");
    L.marker(latlngs.at(-1)).addTo(routeMap).bindPopup("Finish");
    routeMap.fitBounds(L.polyline(latlngs).getBounds());
  };
  window.closeRoute = () => {
    document.getElementById('routeView').style.display = 'none';
  };

  // === STATS PAGE LOGIC ===
  if (document.getElementById('durationChart')) {
    const exercises    = JSON.parse(localStorage.getItem('exercises')||'[]');
    const durationCtx  = document.getElementById('durationChart').getContext('2d');
    const distanceCtx  = document.getElementById('distanceChart').getContext('2d');
    let durationChart, distanceChart;
    const chartModes = { duration:'week', distance:'week' };

    function parseKey(dateStr) {
      const m = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : 'Unknown';
    }

    function renderChart(type, mode) {
      const now = new Date();
      let start, end;
      if (mode==='week') {
        const d    = now.getDay(),
              diff = (d===0?-6:1)-d;
        start = new Date(now); start.setDate(now.getDate()+diff); start.setHours(0,0,0,0);
        end   = new Date(start); end.setDate(start.getDate()+6);
      } else {
        start = new Date(now.getFullYear(), now.getMonth(),1);
        end   = new Date(now.getFullYear(), now.getMonth()+1,0);
      }

      const labels = [], mapData = {};
      for (let dt=new Date(start); dt<=end; dt.setDate(dt.getDate()+1)) {
        const lbl = dt.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
        labels.push(lbl);
        mapData[lbl] = {};
      }

      exercises.forEach(ex => {
        const key = new Date(parseKey(ex.date))
                      .toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
        const val = type==='duration'
                    ? (parseFloat(ex.duration)||0)/3600
                    : parseFloat(ex.distance)||0;
        mapData[key] = mapData[key]||{};
        mapData[key][ex.exerciseType||'Unknown'] =
          (mapData[key][ex.exerciseType||'Unknown']||0) + val;
      });

      const allTypes = new Set();
      Object.values(mapData).forEach(o=>Object.keys(o).forEach(t=>allTypes.add(t)));

      const datasets = Array.from(allTypes).map(t=>({
        label: t,
        data: labels.map(l=>mapData[l][t]||0),
        backgroundColor: '#'+Math.floor(Math.random()*16777215).toString(16)
      }));

      const cfg = {
        type: 'bar',
        data: { labels, datasets },
        options: {
          responsive: true,
          plugins: {
            title: { display: true, text: `${type==='duration'?'Duration (hrs)':'Distance (km)'} by ${mode}` }
          },
          scales: {
            x: { stacked: true },
            y: { stacked: true, beginAtZero: true }
          }
        }
      };

      if (type==='duration') {
        durationChart?.destroy();
        durationChart = new Chart(durationCtx, cfg);
      } else {
        distanceChart?.destroy();
        distanceChart = new Chart(distanceCtx, cfg);
      }
    }

    document.getElementById('durationToggleBtn').onclick = () => {
      chartModes.duration = chartModes.duration==='week'?'month':'week';
      document.getElementById('durationToggleBtn').textContent =
        chartModes.duration==='week'?'Week View':'Month View';
      renderChart('duration', chartModes.duration);
    };
    document.getElementById('distanceToggleBtn').onclick = () => {
      chartModes.distance = chartModes.distance==='week'?'month':'week';
      document.getElementById('distanceToggleBtn').textContent =
        chartModes.distance==='week'?'Week View':'Month View';
      renderChart('distance', chartModes.distance);
    };

    // summary stats
    document.getElementById('totalRuns').textContent = exercises.length;
    let totD=0, totT=0, totS=0, mx=0, mn=Infinity;
    exercises.forEach(ex=>{
      const d=parseFloat(ex.distance)||0,
            t=parseFloat(ex.duration)||0,
            s=(d/t)*3.6;
      totD+=d; totT+=t; totS+=s;
      mx=Math.max(mx,parseFloat(ex.maxSpeed)||0);
      mn=Math.min(mn,parseFloat(ex.minSpeed)||Infinity);
    });
    document.getElementById('totalDistance').textContent   = totD.toFixed(2);
    document.getElementById('totalDuration').textContent   = (totT/3600).toFixed(2);
    document.getElementById('averageSpeed').textContent    = (totS/exercises.length).toFixed(2);
    document.getElementById('maxSpeedOverall').textContent = mx.toFixed(2);
    document.getElementById('minSpeedOverall').textContent = (mn===Infinity?0:mn).toFixed(2);

    renderChart('duration','week');
    renderChart('distance','week');
  }
  document.getElementById('closeModal').addEventListener('click', () => {
    document.getElementById('savedModal').style.display = 'none';
    window.location.reload();  // clears timer, map, etc.
  })
});
