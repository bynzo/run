// === COMMON: Service Worker Registration ===
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
          currentWeather = null,
          running = false,
          timerInterval, startTime, elapsedTime = 0,
          positions = [], watchId,
          map, polyline,
          totalDistance = 0,
          speedSamples = [], maxSpeed = 0, minSpeed = Infinity,
          distanceEl = document.getElementById('distance'),
          currentSpeedEl = document.getElementById('currentSpeed'),
          avgSpeedEl = document.getElementById('avgSpeed'),
          maxSpeedEl = document.getElementById('maxSpeed'),
          minSpeedEl = document.getElementById('minSpeed'),
          timerEl = document.getElementById('timer'),
          btn = document.getElementById('startStopBtn');
  
      document.getElementById('exerciseDropdown').addEventListener('change', e => {
        selectedExerciseType = e.target.value;
      });
  
      function fetchWeather(lat, lon) {
        if (!lat||!lon||isNaN(lat)||isNaN(lon)) return;
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`)
          .then(res => res.json())
          .then(data => {
            if (data.current_weather) {
              const code = data.current_weather.weathercode;
              const desc = code === 0 ? "Clear"
                         : [1,2,3].includes(code) ? "Partly Cloudy"
                         : [45,48].includes(code) ? "Fog"
                         : [51,53,55].includes(code) ? "Drizzle"
                         : [61,63,65].includes(code) ? "Rain"
                         : [66,67].includes(code) ? "Freezing Rain"
                         : [71,73,75].includes(code) ? "Snow"
                         : code === 80 ? "Rain Showers"
                         : code === 95 ? "Thunderstorm"
                         : "Unknown";
              currentWeather = { temperature: data.current_weather.temperature, description: desc };
            }
          })
          .catch(err => console.error("Weather fetch error", err));
      }
  
      function updateTimer() {
        elapsedTime = Math.floor((Date.now() - startTime) / 1000);
        const hrs = String(Math.floor(elapsedTime/3600)).padStart(2,'0'),
              mins = String(Math.floor((elapsedTime%3600)/60)).padStart(2,'0'),
              secs = String(elapsedTime%60).padStart(2,'0');
        timerEl.textContent = `${hrs}:${mins}:${secs}`;
      }
  
      function computeDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3,
              φ1 = lat1 * Math.PI/180,
              φ2 = lat2 * Math.PI/180,
              Δφ = (lat2-lat1)*Math.PI/180,
              Δλ = (lon2-lon1)*Math.PI/180,
              a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2,
              c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R*c;
      }
  
      function startRunning() {
        if (!selectedExerciseType) return alert("Please select an exercise type before starting.");
        running = true;
        startTime = Date.now();
        elapsedTime = 0;
        positions = [];
        totalDistance = 0;
        maxSpeed = 0;
        minSpeed = Infinity;
        speedSamples = [];
        timerInterval = setInterval(updateTimer, 1000);
        btn.textContent = "Stop";
  
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(p => fetchWeather(p.coords.latitude, p.coords.longitude));
          watchId = navigator.geolocation.watchPosition(positionSuccess, positionError, { enableHighAccuracy: true });
        } else {
          alert("Geolocation not supported.");
        }
      }
  
      function stopRunning() {
        running = false;
        clearInterval(timerInterval);
        navigator.geolocation.clearWatch(watchId);
        btn.textContent = "Start";
  
        const exercise = {
          date: new Date(startTime).toLocaleString(),
          duration: elapsedTime,
          distance: (totalDistance/1000).toFixed(2),
          avgSpeed: ((totalDistance/elapsedTime)*3.6).toFixed(2),
          maxSpeed: maxSpeed.toFixed(2),
          minSpeed: (minSpeed===Infinity?0:minSpeed.toFixed(2)),
          positions, exerciseType: selectedExerciseType, weather: currentWeather
        };
        const all = JSON.parse(localStorage.getItem('exercises')||'[]');
        all.push(exercise);
        localStorage.setItem('exercises', JSON.stringify(all));
        alert("Exercise saved!");
      }
  
      function positionSuccess(pos) {
        const { latitude, longitude, speed, accuracy } = pos.coords,
              timestamp = pos.timestamp;
        if (!latitude||!longitude||isNaN(latitude)||accuracy>20) return;
  
        let rawSpeed = 0;
        if (speed!==null && !isNaN(speed) && speed>0.5) {
          rawSpeed = speed;
        } else if (positions.length>0) {
          const prev = positions[positions.length-1],
                d = computeDistance(prev.coords.latitude, prev.coords.longitude, latitude, longitude),
                t = (timestamp - prev.timestamp)/1000;
          if (d<10 || t<3) return;
          rawSpeed = d/t;
          totalDistance += d;
        }
        speedSamples.push(rawSpeed);
        if (speedSamples.length>5) speedSamples.shift();
        const smoothed = speedSamples.reduce((a,b)=>a+b,0)/speedSamples.length;
        if (smoothed>0) {
          maxSpeed = Math.max(maxSpeed, smoothed);
          minSpeed = Math.min(minSpeed, smoothed);
        }
        positions.push({ coords:{latitude,longitude}, timestamp });
        if (polyline) polyline.addLatLng([latitude,longitude]);
        if (map) map.setView([latitude,longitude],16);
  
        distanceEl.textContent = (totalDistance/1000).toFixed(2);
        currentSpeedEl.textContent = (smoothed*3.6).toFixed(2);
        const avg = elapsedTime>0 ? totalDistance/elapsedTime : 0;
        avgSpeedEl.textContent = (avg*3.6).toFixed(2);
        maxSpeedEl.textContent = (maxSpeed*3.6).toFixed(2);
        minSpeedEl.textContent = (minSpeed===Infinity?0:(minSpeed*3.6).toFixed(2));
      }
  
      function positionError(err) {
        console.warn(`ERROR(${err.code}): ${err.message}`);
      }
  
      btn.addEventListener('click', () => running ? stopRunning() : startRunning());
  
      window.onload = () => {
        map = L.map('map').setView([0,0],2);
        L.tileLayer('https://mt1.google.com/vt/lyrs=r&x={x}&y={y}&z={z}', {
          attribution: '© Google Maps', maxZoom: 20
        }).addTo(map);
        polyline = L.polyline([], { color:'red', weight:5 }).addTo(map);
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(p => {
            const lat = p.coords.latitude, lng = p.coords.longitude;
            if (!isNaN(lat)&&!isNaN(lng)) {
              map.setView([lat,lng],16);
              L.marker([lat,lng]).addTo(map).bindPopup("You are here").openPopup();
            }
          });
        }
      };
    }
  
    // === HISTORY PAGE LOGIC ===
    if (document.querySelector('#exercisesTable')) {
      const exercises = JSON.parse(localStorage.getItem('exercises')||'[]');
      const tbody = document.querySelector('#exercisesTable tbody');
      exercises.forEach((ex,i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${ex.date}</td>
          <td>${ex.duration}</td>
          <td>${ex.distance}</td>
          <td>${ex.avgSpeed}</td>
          <td>${ex.maxSpeed}</td>
          <td>${ex.minSpeed}</td>
          <td>${ex.exerciseType||'N/A'}</td>
          <td>${ex.weather?`${ex.weather.description}, ${ex.weather.temperature}°C`:'N/A'}</td>
          <td><button class="nav-button" style="padding:6px 10px; font-size:14px;" onclick="viewRoute(${i})">View</button></td>
        `;
        tbody.appendChild(tr);
      });
  
      window.viewRoute = index => {
        const ex = exercises[index];
        if (!ex||!ex.positions||!ex.positions.length) return alert("No route data available.");
        document.getElementById('routeView').style.display = 'block';
        const mapDiv = document.getElementById('map');
        mapDiv.innerHTML = '';
        if (mapDiv._leaflet_id) mapDiv._leaflet_id = null;
        const map = L.map('map').setView([0,0],13);
        L.tileLayer('https://mt1.google.com/vt/lyrs=r&x={x}&y={y}&z={z}', {
          attribution:'© Google Maps', maxZoom:20
        }).addTo(map);
        const latlngs = ex.positions.map(p=>[p.coords.latitude,p.coords.longitude]);
        const poly = L.polyline(latlngs,{color:'red'}).addTo(map);
        L.marker(latlngs[0]).addTo(map).bindPopup("Start");
        L.marker(latlngs.slice(-1)[0]).addTo(map).bindPopup("Finish");
        map.fitBounds(poly.getBounds());
      };
      window.closeRoute = () => document.getElementById('routeView').style.display ='none';
    }
  
    // === STATS PAGE LOGIC ===
    if (document.getElementById('durationChart')) {
      const exercises = JSON.parse(localStorage.getItem('exercises')||'[]');
      const durationCtx = document.getElementById('durationChart').getContext('2d');
      const distanceCtx = document.getElementById('distanceChart').getContext('2d');
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
          const d = now.getDay(), diff = (d===0?-6:1)-d;
          start = new Date(now); start.setDate(now.getDate()+diff); start.setHours(0,0,0,0);
          end   = new Date(start); end.setDate(start.getDate()+6);
        } else {
          start = new Date(now.getFullYear(), now.getMonth(),1);
          end   = new Date(now.getFullYear(), now.getMonth()+1,0);
        }
        const labels=[], map = {};
        for (let d=new Date(start); d<=end; d.setDate(d.getDate()+1)) {
          const lbl = d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
          labels.push(lbl); map[lbl]={};
        }
        exercises.forEach(ex => {
          const key = new Date(parseKey(ex.date)).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
          const val = type==='duration'?parseFloat(ex.duration)/3600:parseFloat(ex.distance);
          map[key] = map[key]||{};
          map[key][ex.exerciseType||'Unknown'] = (map[key][ex.exerciseType||'Unknown']||0)+val;
        });
        const allTypes = new Set();
        Object.values(map).forEach(o=>Object.keys(o).forEach(t=>allTypes.add(t)));
        const datasets = Array.from(allTypes).map(t=>({
          label: t,
          data: labels.map(l=>map[l][t]||0),
          backgroundColor: '#' + Math.floor(Math.random()*16777215).toString(16)
        }));
        const cfg = { type:'bar',
          data:{ labels, datasets },
          options:{ responsive:true,
            plugins:{ title:{ display:true, text:`${type==='duration'?'Duration (hrs)':'Distance (km)'} by ${mode}` }},
            scales:{ x:{ stacked:true }, y:{ stacked:true, beginAtZero:true } }
          }
        };
        if (type==='duration') { durationChart?.destroy(); durationChart = new Chart(durationCtx, cfg); }
        else              { distanceChart?.destroy(); distanceChart = new Chart(distanceCtx, cfg); }
      }
  
      document.getElementById('durationToggleBtn').onclick = () => {
        chartModes.duration = chartModes.duration==='week'?'month':'week';
        document.getElementById('durationToggleBtn').textContent = chartModes.duration==='week'?'Week View':'Month View';
        renderChart('duration', chartModes.duration);
      };
      document.getElementById('distanceToggleBtn').onclick = () => {
        chartModes.distance = chartModes.distance==='week'?'month':'week';
        document.getElementById('distanceToggleBtn').textContent = chartModes.distance==='week'?'Week View':'Month View';
        renderChart('distance', chartModes.distance);
      };
  
      // summary stats
      document.getElementById('totalRuns').textContent = exercises.length;
      let totD=0, totT=0, totS=0, max=0, min=Infinity;
      exercises.forEach(ex => {
        const d = parseFloat(ex.distance), t = parseFloat(ex.duration),
              s = (d/t)*3.6;
        totD+=d; totT+=t; totS+=s;
        max = Math.max(max, parseFloat(ex.maxSpeed));
        min = Math.min(min, parseFloat(ex.minSpeed));
      });
      document.getElementById('totalDistance').textContent    = totD.toFixed(2);
      document.getElementById('totalDuration').textContent    = (totT/3600).toFixed(2);
      document.getElementById('averageSpeed').textContent     = (totS/exercises.length).toFixed(2);
      document.getElementById('maxSpeedOverall').textContent  = max.toFixed(2);
      document.getElementById('minSpeedOverall').textContent  = min.toFixed(2);
  
      renderChart('duration','week');
      renderChart('distance','week');
    }
  });
  