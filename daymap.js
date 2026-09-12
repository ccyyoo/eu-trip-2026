/* ===== 每日地图 daymap.js =====
 *
 * 把当天 route 里的地点按真实经纬度投影到手绘城市底图上，输出一张 SVG。
 *
 * 设计要点：
 * 1. 底图骨架与路线点位共用同一个投影函数和同一个 viewBox —— 超出视野的
 *    底图由 SVG 自动裁掉。因此不必为每一天单独维护一套坐标，加一天行程
 *    只需要往 PLACES 里补一个点。
 * 2. 投影是等距的（经度按 cos(纬度) 校正），所以图上的方向与实际一致，
 *    「往北走还是往东走」这类判断可以信任；但它仍然是一张示意图，
 *    海岸线与主干道只取了几个转折点，不能当导航用。
 * 3. 跨城段（相邻两点直线距离 > 80km）自动识别为长途交通，改用虚线 +
 *    ✈；route 里显式写了车次的（TGV 6188 / RER C / RER B）按 rail 处理。
 * 4. 住宿点坐标取酒店官网或官方旅游局公布的 GPS，地标取公开常用坐标，
 *    精度足够支撑「相对位置」判断，不追求米级准确。
 */
(function () {
  'use strict';

  /* ---------- 地点坐标表 ----------
   * 格式：'行程里的地名': [经度, 纬度, Google Maps 搜索词]
   * 第三项用于地图上每个点的「点击搜索」，中文简称（如「老城」）直接搜会偏，
   * 所以统一给出当地语言的准确搜索词。
   */
  var PLACES = {
    // ===== 巴塞罗那 =====
    'BCN T1':              [2.0750, 41.2580, 'Barcelona Airport T1'],
    '西班牙广场':           [2.1490, 41.3750, 'Plaça d\'Espanya Barcelona'],
    '酒店 (英迪格)':        [2.1474, 41.3734, 'Hotel Indigo Barcelona Plaza España'],
    '英迪格酒店':           [2.1474, 41.3734, 'Hotel Indigo Barcelona Plaza España'],
    'Maria Cristina 舞台':  [2.1485, 41.3724, 'Avinguda de la Reina Maria Cristina Barcelona'],
    'Jaume I 站':          [2.1788, 41.3830, 'Jaume I Metro Station Barcelona'],
    '哥特区':              [2.1765, 41.3825, 'Barri Gòtic Barcelona'],
    '毕加索馆':            [2.1807, 41.3850, 'Museu Picasso Barcelona'],
    'Bogatell 海滩':       [2.1960, 41.3950, 'Platja del Bogatell Barcelona'],
    'Pestana Arena':       [2.1460, 41.3766, 'Pestana Arena Barcelona'],
    'Vallcarca 站':        [2.1419, 41.4123, 'Vallcarca Metro Station Barcelona'],
    '桂尔公园':            [2.1527, 41.4145, 'Park Güell Barcelona'],
    '圣保罗医院':          [2.1748, 41.4125, 'Recinte Modernista de Sant Pau Barcelona'],
    '圣家堂':              [2.1744, 41.4036, 'Sagrada Família Barcelona'],
    '音乐宫':              [2.1753, 41.3878, 'Palau de la Música Catalana Barcelona'],
    'Barceloneta 海滩':    [2.1900, 41.3790, 'Platja de la Barceloneta Barcelona'],
    '蒙特惠奇城堡':        [2.1660, 41.3635, 'Castell de Montjuïc Barcelona'],
    '山地花园':            [2.1620, 41.3685, 'Jardins de Mossèn Costa i Llobera Barcelona'],
    'MNAC':                [2.1560, 41.3688, 'Museu Nacional d\'Art de Catalunya Barcelona'],
    'Poble-sec':           [2.1590, 41.3700, 'Poble-sec Barcelona'],
    '圣卡特琳娜市场':       [2.1778, 41.3859, 'Mercat de Santa Caterina Barcelona'],
    '大教堂':              [2.1760, 41.3839, 'Catedral de Barcelona'],
    "Portal de l'Àngel":   [2.1735, 41.3855, 'Portal de l\'Àngel Barcelona'],
    '兰布拉':              [2.1730, 41.3800, 'La Rambla Barcelona'],

    // ===== 尼斯 / 昂蒂布 =====
    '尼斯机场民宿':         [7.2159, 43.6699, '52 Boulevard René Cassin Nice'],
    '机场民宿':            [7.2159, 43.6699, '52 Boulevard René Cassin Nice'],
    'ibis 存包':           [7.2832, 43.7003, 'ibis Styles Nice Vieux Port'],
    'ibis':                [7.2832, 43.7003, 'ibis Styles Nice Vieux Port'],
    'ibis 酒店':           [7.2832, 43.7003, 'ibis Styles Nice Vieux Port'],
    '城堡山':              [7.2790, 43.6960, 'Colline du Château Nice'],
    '老城':                [7.2730, 43.6965, 'Vieux Nice'],
    'Cours Saleya':        [7.2735, 43.6943, 'Cours Saleya Nice'],
    'Plage Beau Rivage':   [7.2690, 43.6945, 'Plage Beau Rivage Nice'],
    '老港':                [7.2850, 43.6940, 'Port Lympia Nice'],
    'Nice-Ville 站':       [7.2620, 43.7040, 'Gare de Nice-Ville'],
    'Antibes 老城':        [7.1260, 43.5810, 'Vieil Antibes'],
    '港口':                [7.1220, 43.5860, 'Port Vauban Antibes'],
    'Sentier du Littoral': [7.1310, 43.5560, 'Sentier du Littoral Cap d\'Antibes'],
    'Château de Crémat':   [7.2088, 43.7239, 'Château de Crémat Nice'],

    // ===== 巴黎 =====
    'Paris Gare de Lyon': [2.3740, 48.8445, 'Gare de Lyon Paris'],
    '3 Rue Lecuirot 公寓': [2.3206, 48.8292, 'Rue Lecuirot 75014 Paris'],
    '3 Rue Lecuirot':      [2.3206, 48.8292, 'Rue Lecuirot 75014 Paris'],
    '奥赛博物馆':          [2.3266, 48.8599, 'Musée d\'Orsay Paris'],
    'Alésia':              [2.3270, 48.8280, 'Alésia Metro Station Paris'],
    'Alésia M4':           [2.3270, 48.8280, 'Alésia Metro Station Paris'],
    'St-Michel':           [2.3430, 48.8530, 'Saint-Michel Paris'],
    '凡尔赛':              [2.1204, 48.8049, 'Château de Versailles'],
    'Catacombes':          [2.3324, 48.8338, 'Catacombes de Paris'],
    '西岱岛':              [2.3470, 48.8545, 'Île de la Cité Paris'],
    '拉丁区':              [2.3440, 48.8490, 'Quartier Latin Paris'],
    'Opéra Garnier':       [2.3316, 48.8720, 'Opéra Garnier Paris'],
    '橘园':                [2.3200, 48.8638, 'Musée de l\'Orangerie Paris'],
    '海军府(弹性)':        [2.3220, 48.8660, 'Hôtel de la Marine Paris'],
    '卢浮宫':              [2.3376, 48.8606, 'Musée du Louvre Paris'],
    '卢森堡公园':          [2.3372, 48.8462, 'Jardin du Luxembourg Paris'],
    '先贤祠':              [2.3464, 48.8462, 'Panthéon Paris'],
    '玛黑区':              [2.3610, 48.8570, 'Le Marais Paris'],
    '蒙马特':              [2.3431, 48.8867, 'Montmartre Paris'],
    '圣心大教堂':          [2.3431, 48.8867, 'Sacré-Cœur Paris'],
    'CDG T2C':             [2.5700, 49.0030, 'Paris Charles de Gaulle Airport Terminal 2C'],
    '登机':                [2.5700, 49.0030, 'Paris Charles de Gaulle Airport Terminal 2C']
  };

  /* 交通节点：不是地理停留点，只把前后两点连成一段并在线中标注车次。
     坐标运行时按前后两点取中点，这里只声明它是哪一种交通。 */
  var TRANSIT = {
    'TGV 6188': 'rail',
    'RER C': 'rail',
    'RER B': 'rail'
  };

  /* ---------- 底图骨架 ----------
   * 全部用 [经度, 纬度] 序列描述。精度只要能认出「这是哪座城市」即可：
   * 海岸线取十来个转折点，主干道取走向，河流取几段。
   */
  var BASE = {
    // 跨城市：西班牙东北 → 法国地中海沿岸 → 巴黎。
    // 不填海面：这个尺度下平移法向会把大块内陆一起划进海里，留线条反而更准确。
    macro: {
      label: '西南欧',
      coast: [
        [7.55, 43.78], [7.42, 43.74], [7.28, 43.70], [7.13, 43.58], [7.02, 43.53],
        [6.70, 43.32], [6.40, 43.20], [6.10, 43.12], [5.85, 43.12], [5.60, 43.20],
        [5.37, 43.29], [5.10, 43.30], [4.80, 43.33], [4.30, 43.45], [3.90, 43.52],
        [3.50, 43.42], [3.20, 43.28], [3.00, 43.05], [3.02, 42.90], [3.05, 42.70],
        [3.10, 42.55], [3.16, 42.44], [3.05, 41.85], [2.80, 41.68], [2.45, 41.52],
        [2.15, 41.37]
      ],
      border: [[3.16, 42.44], [2.60, 42.60], [1.80, 42.75], [1.00, 42.85], [0.20, 42.90]],
      river: [
        [4.835, 45.764], [4.80, 45.30], [4.72, 44.80], [4.63, 44.30], [4.62, 43.90],
        [4.68, 43.70], [4.63, 43.45], [4.75, 43.30], [4.85, 43.35], [4.90, 43.40]
      ],
      rail: [
        [7.270, 43.703], [7.02, 43.55], [6.50, 43.35], [5.93, 43.12], [5.37, 43.30],
        [4.90, 43.60], [4.83, 45.76], [3.90, 47.30], [2.352, 48.857]
      ],
      cities: [
        [2.152, 41.389, 'Barcelona'], [7.270, 43.703, 'Nice'], [2.352, 48.857, 'Paris'],
        [5.370, 43.296, 'Marseille'], [4.835, 45.764, 'Lyon'], [3.878, 43.611, 'Montpellier']
      ],
      notes: [[5.20, 42.60, '地中海'], [1.30, 44.20, 'France'], [1.60, 41.30, 'España']]
    },

    // 巴塞罗那（机场到 Besòs 河口，海在东南 → seaSide: right）
    bcn: {
      label: '巴塞罗那',
      seaSide: 'right',
      coast: [
        [2.070, 41.283], [2.082, 41.294], [2.096, 41.302], [2.108, 41.318],
        [2.120, 41.330], [2.135, 41.345], [2.150, 41.356], [2.165, 41.364],
        [2.178, 41.371], [2.185, 41.377], [2.190, 41.388], [2.196, 41.398],
        [2.202, 41.408], [2.208, 41.418], [2.215, 41.428], [2.222, 41.436]
      ],
      hill: [
        [2.144, 41.360], [2.152, 41.368], [2.165, 41.372], [2.175, 41.366],
        [2.172, 41.356], [2.160, 41.352], [2.148, 41.354], [2.144, 41.360]
      ],
      road: [
        // Gran Via
        [[2.108, 41.371], [2.130, 41.373], [2.149, 41.375], [2.165, 41.383], [2.180, 41.396], [2.190, 41.407], [2.200, 41.414]],
        // Avinguda Diagonal
        [[2.105, 41.387], [2.125, 41.390], [2.145, 41.393], [2.162, 41.396], [2.178, 41.400], [2.190, 41.409], [2.205, 41.415], [2.220, 41.421]],
        // La Rambla → Plaça Catalunya → Passeig de Gràcia
        [[2.169, 41.371], [2.172, 41.378], [2.174, 41.384], [2.173, 41.388], [2.167, 41.391], [2.168, 41.396]]
      ],
      river: [
        [[2.108, 41.318], [2.113, 41.330], [2.120, 41.340], [2.125, 41.350]],
        [[2.222, 41.436], [2.215, 41.425], [2.210, 41.412], [2.206, 41.400]]
      ],
      notes: [[2.190, 41.345, '地中海'], [2.158, 41.364, 'Montjuïc'], [2.163, 41.397, 'Eixample']]
    },

    // 尼斯 + 昂蒂布（海岸线自东北的 Monaco 往西南到 Cap d'Antibes，海在东南 → seaSide: left）
    nce: {
      label: '尼斯 / 昂蒂布',
      seaSide: 'left',
      coast: [
        [7.310, 43.706], [7.298, 43.703], [7.288, 43.700], [7.278, 43.696],
        [7.265, 43.693], [7.250, 43.690], [7.232, 43.684], [7.215, 43.676],
        [7.200, 43.668], [7.185, 43.660], [7.175, 43.650], [7.160, 43.640],
        [7.148, 43.628], [7.140, 43.615], [7.128, 43.600], [7.115, 43.585],
        [7.106, 43.572], [7.112, 43.558], [7.125, 43.545], [7.133, 43.535]
      ],
      road: [
        // Promenade des Anglais
        [[7.198, 43.668], [7.230, 43.685], [7.260, 43.692], [7.278, 43.696]]
      ],
      river: [
        // Le Var
        [[7.190, 43.660], [7.185, 43.650], [7.178, 43.640], [7.170, 43.628], [7.165, 43.615], [7.160, 43.600]],
        // Le Paillon
        [[7.245, 43.715], [7.252, 43.705], [7.260, 43.696], [7.268, 43.688], [7.272, 43.680]]
      ],
      notes: [[7.240, 43.672, 'Baie des Anges'], [7.150, 43.545, 'Cap d\'Antibes']]
    },

    // 巴黎
    par: {
      label: '巴黎',
      coast: null,
      river: [
        // La Seine（东南进、西南出）
        [[2.398, 48.834], [2.385, 48.838], [2.370, 48.845], [2.362, 48.850],
         [2.348, 48.853], [2.341, 48.857], [2.330, 48.860], [2.322, 48.863],
         [2.313, 48.864], [2.305, 48.864], [2.290, 48.860], [2.280, 48.855],
         [2.270, 48.848], [2.255, 48.842], [2.240, 48.838]]
      ],
      island: [
        // Île de la Cité
        [[2.338, 48.856], [2.348, 48.858], [2.353, 48.855], [2.345, 48.851], [2.339, 48.853], [2.338, 48.856]],
        // Île Saint-Louis
        [[2.354, 48.852], [2.362, 48.854], [2.358, 48.849], [2.352, 48.849], [2.354, 48.852]]
      ],
      ring: { lon: 2.352, lat: 48.856, a: 0.058, b: 0.038 },
      road: [
        // 香榭丽舍历史轴（Étoile → Concorde → Louvre）
        [[2.295, 48.870], [2.315, 48.869], [2.322, 48.863], [2.330, 48.861], [2.340, 48.858]]
      ],
      rail: [
        // RER B（St-Michel → Gare du Nord → CDG）
        [[2.343, 48.853], [2.352, 48.862], [2.355, 48.880], [2.400, 48.920], [2.500, 48.960], [2.570, 49.003]]
      ],
      notes: [[2.270, 48.838, 'La Seine'], [2.150, 48.870, 'Versailles ←']]
    }
  };

  // 城市锚点，用于「当天点集落在哪座城市」的判定
  var CITY_ANCHOR = [
    { k: 'bcn', lon: 2.152, lat: 41.389 },
    { k: 'nce', lon: 7.270, lat: 43.703 },
    { k: 'par', lon: 2.352, lat: 48.857 }
  ];

  var KM_LAT = 110.574;   // 1 纬度 ≈ 公里
  var KM_LON = 111.320;   // 1 经度 ≈ 公里（赤道）
  var LONG_HAUL_KM = 80;  // 超过这个距离视为长途交通段

  function km(a, b) {
    var clat = (a.lat + b.lat) / 2 * Math.PI / 180;
    var dx = (a.lon - b.lon) * KM_LON * Math.cos(clat);
    var dy = (a.lat - b.lat) * KM_LAT;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* 把当天的 route 解析成有序节点。
     返回 { stops:[{name,lon,lat,q}], legs:[{from,to,kind,label}] } */
  function parseRoute(route) {
    var stops = [], legs = [], prev = null, pendingTransit = null;
    // prev 存的是 stops 里的下标，首次循环时才能区分「还没有上一个点」和「上一个点是 0 号」

    (route || []).forEach(function (name) {
      if (TRANSIT[name]) {
        // 交通节点先记下，等取到下一个真实地点再算中点
        pendingTransit = { name: name, kind: TRANSIT[name] };
        return;
      }
      var p = PLACES[name];
      if (!p) return; // 表里没有的点直接跳过，不画
      var stop = { name: name, lon: p[0], lat: p[1], q: p[2] || name };
      var idx = stops.length;
      if (pendingTransit && prev !== null) {
        // 交通段：起终点是前后两个真实地点，标签挂在中点
        legs.push({ a: prev, b: idx, kind: pendingTransit.kind, label: pendingTransit.name });
        pendingTransit = null;
      } else if (prev !== null) {
        var d = km(stops[prev], stop);
        legs.push({ a: prev, b: idx, kind: d > LONG_HAUL_KM ? 'air' : 'walk', label: '' });
      }
      stops.push(stop);
      prev = idx;
    });

    return { stops: stops, legs: legs };
  }

  function pickBase(stops) {
    if (!stops.length) return BASE.bcn;
    var lo = Infinity, hi = -Infinity, la = Infinity, lb = -Infinity;
    stops.forEach(function (s) {
      lo = Math.min(lo, s.lon); hi = Math.max(hi, s.lon);
      la = Math.min(la, s.lat); lb = Math.max(lb, s.lat);
    });
    var clon = (lo + hi) / 2, clat = (la + lb) / 2;
    var span = km({ lon: lo, lat: la }, { lon: hi, lat: lb });
    if (span > 120) return BASE.macro;

    var best = null, bestD = Infinity;
    CITY_ANCHOR.forEach(function (c) {
      var d = km({ lon: clon, lat: clat }, { lon: c.lon, lat: c.lat });
      if (d < bestD) { bestD = d; best = c.k; }
    });
    return BASE[best] || BASE.macro;
  }

  /* 手机上一屏宽度只有约 300px，而城市内一天的路线常常是南北向的细长条
     （巴黎 D10 实测 1.3km 宽 × 4.9km 高）。完全按真实比例画，图会高到占掉一屏半；
     限制高度又会横向撑出大片空白。
     折中：宽高比夹在 [RATIO_MIN, RATIO_MAX] 之间，超出的部分做纵向压缩。
     方向和先后顺序始终可信，纵向距离比例在极端情况下会被压扁 —— 图脚已注明。 */
  var RATIO_MIN = 0.42, RATIO_MAX = 0.85;

  function makeView(stops, outW) {
    var lo = Infinity, hi = -Infinity, la = Infinity, lb = -Infinity;
    stops.forEach(function (s) {
      lo = Math.min(lo, s.lon); hi = Math.max(hi, s.lon);
      la = Math.min(la, s.lat); lb = Math.max(lb, s.lat);
    });
    var clon = (lo + hi) / 2, clat = (la + lb) / 2;
    var kx = KM_LON * Math.cos(clat * Math.PI / 180);
    var wKm = Math.max((hi - lo) * kx, 0.4);
    var hKm = Math.max((lb - la) * KM_LAT, 0.4);

    /* 留白按「当天范围的较长边」给绝对值，避免细长路线被比例留白越拉越长。
       系数 0.18 是量出来的：0.12 时首尾节点会被推到离画布边只剩 30 多单位，
       地名标签往哪个方向伸都会出界（D8 尼斯→巴黎那天两个标签全放不下）。
       留到 0.18 之后，最靠边的点也还有地方放字。 */
    var pad = Math.max(wKm, hKm) * 0.18 + 0.4;
    var wPad = wKm + pad * 2, hPad = hKm + pad * 2;

    var ratio = hPad / wPad;
    var viewRatio = ratio < RATIO_MIN ? RATIO_MIN : (ratio > RATIO_MAX ? RATIO_MAX : ratio);
    var H = outW * viewRatio;

    // 横纵各算一个比例尺：没有被夹逼时两者相等（等比），被夹逼时纵向被压缩
    var scaleX = outW / wPad;
    var scaleY = H / hPad;
    return {
      w: outW, h: H, ratio: viewRatio, clon: clon, clat: clat,
      spanKm: Math.max(wPad, hPad),
      X: function (lon) { return outW / 2 + (lon - clon) * kx * scaleX; },
      Y: function (lat) { return H / 2 + (clat - lat) * KM_LAT * scaleY; }
    };
  }

  function linePath(line, v) {
    var d = '';
    for (var i = 0; i < line.length; i++) {
      d += (i ? 'L' : 'M') + v.X(line[i][0]).toFixed(1) + ' ' + v.Y(line[i][1]).toFixed(1);
    }
    return d;
  }

  /* 把海岸线整体平移出去，再沿海岸线折回，得到海面多边形。
   *
   * 两个坑都踩过一次，记在这里：
   * 1) 偏移量必须是「度」，不能直接拿公里数去加经度——100 倍的差距会把海面甩到画面外。
   * 2) 「哪一侧是海」不能用几何启发式猜。巴塞罗那的海在海岸线的东南，
   *    但当天点集（机场 + 市区）落在海岸线的西北与西南两个方向，没有一致规律；
   *    因此改为在底图数据里用 seaSide 显式声明。
   * 另外用「整条线的统一法向」而不是逐点法向，否则折线拐弯处偏移线会自交，
   * 海面多边形会打出结。
   */
  function seaPoly(coast, seaSide, D) {
    var n = coast.length;
    var ex = coast[n - 1][0] - coast[0][0];
    var ey = coast[n - 1][1] - coast[0][1];
    var el = Math.sqrt(ex * ex + ey * ey) || 1;
    var ux, uy;
    if (seaSide === 'left') { ux = -ey / el; uy = ex / el; }
    else { ux = ey / el; uy = -ex / el; }
    var off = [];
    for (var j = n - 1; j >= 0; j--) {
      off.push([coast[j][0] + ux * D, coast[j][1] + uy * D]);
    }
    return coast.concat(off);
  }

  function ringPath(r, v) {
    var d = '';
    for (var i = 0; i <= 48; i++) {
      var t = i / 48 * Math.PI * 2;
      d += (i ? 'L' : 'M') + v.X(r.lon + r.a * Math.cos(t)).toFixed(1) + ' ' + v.Y(r.lat + r.b * Math.sin(t)).toFixed(1);
    }
    return d + 'Z';
  }

  /* 一天的行程里常有几个地点相距不到 200m（D1 的西班牙广场、酒店、Maria Cristina
     三者挤在 15km 的视野里只有几个像素），圆点会完全叠住，看上去像漏画了。
     这里把互相贴住的点推开：位置有几十米的示意性偏移，
     换来「N 个地点确实都画出来了」这个更要紧的事实不被掩盖。

     之前用「先聚类、再把一组摆到圆周上」的做法，实测会漏：D9 的 1 号与 6 号
     分属两个组，各自摊开之后又撞到一起，间距只剩 9。局部一次性摆位收敛不了，
     改成对所有点对反复松弛：每轮把过近的点对互相推开，同时给一个回到真实位置的
     弱回弹力（防止整体漂走、方向失真），再夹回视野内。夹紧会重新造出重叠，
     所以末尾补几轮只推不回弹，把重叠排干净。 */
  function spreadOverlaps(pts, minD, bounds) {
    var n = pts.length;
    if (n < 2) return;
    var ox = pts.map(function (p) { return p.x; });
    var oy = pts.map(function (p) { return p.y; });
    var pull = 0.06;   // 回弹强度：够拉住不漂，又不会把点拽回重叠
    var it, i, j;

    function pushApart() {
      var moved = false;
      for (i = 0; i < n; i++) {
        for (j = i + 1; j < n; j++) {
          var dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d >= minD) continue;
          if (d < 0.01) {
            // 完全重合时没有方向可推，用黄金角给一个确定性的分散方向
            var a = i * 2.39996323;
            dx = Math.cos(a); dy = Math.sin(a); d = 1;
          }
          var f = (minD - d) / 2 / d + 0.01;
          pts[i].x -= dx * f; pts[i].y -= dy * f;
          pts[j].x += dx * f; pts[j].y += dy * f;
          moved = true;
        }
      }
      return moved;
    }

    function clamp() {
      for (i = 0; i < n; i++) {
        pts[i].x = Math.max(bounds.pad, Math.min(bounds.w - bounds.pad, pts[i].x));
        pts[i].y = Math.max(bounds.pad, Math.min(bounds.h - bounds.pad, pts[i].y));
      }
    }

    for (it = 0; it < 120; it++) {
      if (!pushApart()) break;
      for (i = 0; i < n; i++) {
        pts[i].x += (ox[i] - pts[i].x) * pull;
        pts[i].y += (oy[i] - pts[i].y) * pull;
      }
      clamp();
    }
    for (it = 0; it < 30; it++) {
      if (!pushApart()) break;
      clamp();
    }
  }

  /* 地名标签挑位置：八个候选方向里选第一个既不压住别的圆点、不压住已放好的标签、
     也不出画布的。
     最早是固定「看 x 决定左右、看 y 决定上下」两条规则，实测 D4/D12 的起点标签
     会正好糊在 3 号/4 号圆上——两个点落在同一侧时，这个简单规则必然撞车。
     改成多候选逐个试，并把试过的位置记进 placed，让先后两个标签之间也互相避让。 */
  function placeLabel(x, y, name, pts, self, W, H, placed) {
    var w = 0;
    for (var k = 0; k < name.length; k++) {
      w += name.charCodeAt(k) > 255 ? 21 : 11;   // 中日韩字按一个字宽算，西文按半宽
    }
    var cands = [
      { anchor: 'start', tx: x + 28, ty: y + 7 },
      { anchor: 'end', tx: x - 28, ty: y + 7 },
      { anchor: 'middle', tx: x, ty: y + 44 },
      { anchor: 'middle', tx: x, ty: y - 32 },
      { anchor: 'start', tx: x + 22, ty: y + 36 },
      { anchor: 'end', tx: x - 22, ty: y + 36 },
      { anchor: 'start', tx: x + 22, ty: y - 28 },
      { anchor: 'end', tx: x - 22, ty: y - 28 },
      { anchor: 'middle', tx: x, ty: y + 62 },
      { anchor: 'middle', tx: x, ty: y - 50 }
    ];
    var best = null;
    for (var c = 0; c < cands.length; c++) {
      var o = cands[c];
      var x0 = o.anchor === 'start' ? o.tx : (o.anchor === 'end' ? o.tx - w : o.tx - w / 2);
      var x1 = x0 + w;
      var y0 = o.ty - 17, y1 = o.ty + 7;
      if (x0 < 2 || x1 > W - 2 || y0 < 2 || y1 > H - 2) continue;
      var hit = false;
      for (var m = 0; m < pts.length && !hit; m++) {
        if (m === self) continue;
        // 矩形到圆心的最近点距离，小于圆半径 + 余量即算压住。
        // 余量留到 22 是因为估算字宽与实际 getBBox 有出入，宁可多躲一点
        var nx = Math.max(x0, Math.min(pts[m].x, x1));
        var ny = Math.max(y0, Math.min(pts[m].y, y1));
        if (Math.hypot(pts[m].x - nx, pts[m].y - ny) < 22) hit = true;
      }
      for (var q = 0; q < placed.length && !hit; q++) {
        if (x0 < placed[q].x1 + 6 && x1 > placed[q].x0 - 6 &&
          y0 < placed[q].y1 + 4 && y1 > placed[q].y0 - 4) hit = true;
      }
      if (!hit) {
        var bx = o.anchor === 'start' ? o.tx : (o.anchor === 'end' ? o.tx - w : o.tx - w / 2);
        placed.push({ x0: bx, x1: bx + w, y0: y0, y1: y1 });
        return o;
      }
    }
    /* 八个方向全被占：这一天该处的点本来就挤（D9 的巴黎拉丁区五点在 45×76 里），
       硬塞一个标签只会糊在圆点上，比不画更糟——地名在下方清单里一份不少。
       返回 null，调用方跳过这个标签。 */
    return null;
  }

  /* 生成一天地图的 HTML（SVG + 下方可点清单） */
  function render(day) {
    var parsed = parseRoute(day.route);
    var stops = parsed.stops;
    if (stops.length < 2) return '';

    var base = pickBase(stops);
    /* viewBox 宽度 440：手机上卡片内宽约 300px，缩放约 0.68。
       这个比例下 r=12 的节点直径约 16px、序号约 11px、r=30 的透明热区约 41px，
       刚好跨过 40px 触控标准。改这个数时要同时复核那三个值。 */
    var OUT_W = 440;
    var v = makeView(stops, OUT_W);

    // 屏幕坐标：重叠点先摊开。底图的 notes 冲突检测、连线和圆点都读这一份，
    // 保证「同一个点在图上只有一个位置」。
    var pts = stops.map(function (s) { return { x: v.X(s.lon), y: v.Y(s.lat) }; });
    // 夹取边距 40：节点半径 12 + 标签往外伸 28，贴着 34 的话标签必然出界
    spreadOverlaps(pts, 30, { pad: 40, w: OUT_W, h: v.h });

    var svg = [];
    svg.push('<svg class="dm-svg" viewBox="0 0 ' + OUT_W + ' ' + v.h.toFixed(0) +
      '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' +
      esc(day.dateLabel + ' ' + day.city + ' 路线示意图') + '">');

    // ---- 底图 ----
    // 先铺一层陆地基色，再叠海面；有海陆对比，图才有「地图感」而不只是线条
    svg.push('<rect class="dm-land" width="' + OUT_W + '" height="' + v.h.toFixed(0) + '"/>');
    if (base.coast && base.seaSide) {
      // 平移距离取视野的对角量级，保证视野内的海全被盖住；换算成度（约 100km/度）
      var D = v.spanKm * 1.2 / 100;
      svg.push('<path class="dm-sea" d="' + linePath(seaPoly(base.coast, base.seaSide, D), v) + 'Z"/>');
    }
    if (base.ring) {
      svg.push('<path class="dm-ring" d="' + ringPath(base.ring, v) + '"/>');
    }
    if (base.hill) {
      svg.push('<path class="dm-hill" d="' + linePath(base.hill, v) + 'Z"/>');
    }
    if (base.river) {
      base.river.forEach(function (l) {
        svg.push('<path class="dm-river" d="' + linePath(l, v) + '"/>');
      });
    }
    if (base.island) {
      base.island.forEach(function (l) {
        svg.push('<path class="dm-island" d="' + linePath(l, v) + 'Z"/>');
      });
    }
    if (base.road) {
      base.road.forEach(function (l) {
        svg.push('<path class="dm-road" d="' + linePath(l, v) + '"/>');
      });
    }
    if (base.rail) {
      base.rail.forEach(function (l) {
        svg.push('<path class="dm-rail" d="' + linePath(l, v) + '"/>');
      });
    }
    if (base.border) {
      svg.push('<path class="dm-border" d="' + linePath(base.border, v) + '"/>');
    }
    if (base.coast) {
      svg.push('<path class="dm-coast" d="' + linePath(base.coast, v) + '"/>');
    }
    if (base.cities) {
      base.cities.forEach(function (c) {
        svg.push('<circle class="dm-city" cx="' + v.X(c[0]).toFixed(1) + '" cy="' + v.Y(c[1]).toFixed(1) + '" r="4"/>');
        svg.push('<text class="dm-city-t" x="' + (v.X(c[0]) + 8).toFixed(1) + '" y="' + (v.Y(c[1]) + 4).toFixed(1) + '">' + esc(c[2]) + '</text>');
      });
    }
    if (base.notes) {
      base.notes.forEach(function (n) {
        var nx = v.X(n[0]), ny = v.Y(n[1]);
        // 底图地名是背景信息，压到路线节点上只会添乱，就近有节点时直接不画
        var clash = pts.some(function (p) {
          return Math.abs(p.x - nx) < 70 && Math.abs(p.y - ny) < 34;
        });
        if (clash) return;
        svg.push('<text class="dm-note" x="' + nx.toFixed(1) + '" y="' + ny.toFixed(1) +
          '" text-anchor="middle">' + esc(n[2]) + '</text>');
      });
    }

    // ---- 连线 ----
    parsed.legs.forEach(function (leg) {
      var x1 = pts[leg.a].x, y1 = pts[leg.a].y;
      var x2 = pts[leg.b].x, y2 = pts[leg.b].y;
      var cls = leg.kind === 'walk' ? 'dm-leg' : 'dm-leg dm-leg-far';
      svg.push('<line class="' + cls + '" x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) +
        '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="' + (day.color || 'var(--accent)') + '"/>');

      if (leg.label) {
        // 交通段：中点放一个小胶囊标签
        var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        var icon = leg.kind === 'rail' ? '🚄' : '✈';
        var txt = icon + ' ' + leg.label;
        var wpx = txt.length * 9.5 + 18;
        svg.push('<g class="dm-chip">');
        svg.push('<rect x="' + (mx - wpx / 2).toFixed(1) + '" y="' + (my - 13).toFixed(1) +
          '" width="' + wpx.toFixed(1) + '" height="26" rx="13"/>');
        svg.push('<text x="' + mx.toFixed(1) + '" y="' + (my + 5).toFixed(1) + '" text-anchor="middle">' + esc(txt) + '</text>');
        svg.push('</g>');
      } else if (leg.kind === 'air') {
        var ax = (x1 + x2) / 2, ay = (y1 + y2) / 2;
        svg.push('<text class="dm-fly" x="' + ax.toFixed(1) + '" y="' + (ay - 10).toFixed(1) +
          '" text-anchor="middle">✈</text>');
      }
    });

    // ---- 节点 ----
    /* 只给起点和终点写地名。中间站的名都写出来，在 440 单位宽里必然互相压住，
       而「从哪出发、到哪结束」才是第一眼要读的信息，中间站交给下方清单。 */
    var placed = [];
    stops.forEach(function (s, i) {
      var x = pts[i].x, y = pts[i].y;
      var isEnd = (i === 0 || i === stops.length - 1);
      svg.push('<a class="dm-node" href="' + esc(gmapUrl(s.q)) + '" target="_blank" rel="noopener">');
      // 透明热区：手机上 12 单位的圆点只有约 9px，手指点不中，这里外扩一圈不可见的命中区
      svg.push('<circle class="dm-hit" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="30"/>');
      svg.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="12" fill="' + (day.color || 'var(--accent)') + '"/>');
      svg.push('<text class="dm-num" x="' + x.toFixed(1) + '" y="' + (y + 5).toFixed(1) +
        '" text-anchor="middle">' + (i + 1) + '</text>');
      if (isEnd) {
        var lp = placeLabel(x, y, s.name, pts, i, OUT_W, v.h, placed);
        // lp 为 null = 八个方向都放不下，宁可不画也不糊住圆点（地名在下方清单里）
        if (lp) {
          svg.push('<text class="dm-lbl" x="' + lp.tx.toFixed(1) + '" y="' + lp.ty.toFixed(1) +
            '" text-anchor="' + lp.anchor + '">' + esc(s.name) + '</text>');
        }
      }
      svg.push('</a>');
    });

    svg.push('</svg>');

    // ---- 下方清单：编号与地图一一对应，每个可点开地图 ----
    var list = stops.map(function (s, i) {
      return '<a class="dm-item" href="' + esc(gmapUrl(s.q)) + '" target="_blank" rel="noopener">' +
        '<span class="dm-item-n" style="background:' + (day.color || 'var(--accent)') + '">' + (i + 1) + '</span>' +
        '<span class="dm-item-t">' + esc(s.name) + '</span>' +
        '<span class="dm-item-go" aria-hidden="true">›</span>' +
        '</a>';
    }).join('');

    return '<div class="day-map">' +
      '<div class="day-map-canvas">' + svg.join('') + '</div>' +
      '<div class="day-map-list">' + list + '</div>' +
      '<div class="day-map-foot">按真实经纬度绘制 · 点圆点或清单可打开地图 · ' + esc(base.label) + ' · 示意图，不作导航依据</div>' +
      '</div>';
  }

  function gmapUrl(q) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }

  window.dayMap = render;
  window.dayMapPlaces = PLACES;
})();
