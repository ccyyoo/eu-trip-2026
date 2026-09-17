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
 * 5. 视觉上是两套语言分工（G 方案）：底图继续手绘纸感，负责「这是本旅行手册、
 *    地理方位可信」；路线层换成地铁线路图语法（45° 折线 + 纸色套管 + 车站 +
 *    全站标签），负责「先后顺序一眼看懂」。关键的减法在底图：道路/铁路/环线
 *    在 CSS 里压到近乎隐身，否则手绘碎线会和地铁折线互抢。
 * 6. 著名景点（圣家堂、卢浮宫、凡尔赛…）用 48 网格的纯描边手绘图标表示，
 *    配一张纸色圆片和右下角的编号徽章；酒店 / 民宿 / 地铁站一律保持普通车站，
 *    全画成图标就没有层次了。
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
    '成都小馆':            [2.1712, 41.3915, 'Restaurante Chengdu Barcelona'],

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
      /* river / rail 是「线的数组」——每条线本身还是点数组，所以这里要套两层。
         macro 原本写成单层点数组，渲染时 linePath 会拿到数字而不是 [lon,lat]，
         算出全 NaN 的路径被浏览器静默丢掉：跨城日（D5/D8）的罗讷河和铁路
         其实一直没画出来。 */
      river: [[
        [4.835, 45.764], [4.80, 45.30], [4.72, 44.80], [4.63, 44.30], [4.62, 43.90],
        [4.68, 43.70], [4.63, 43.45], [4.75, 43.30], [4.85, 43.35], [4.90, 43.40]
      ]],
      rail: [[
        [7.270, 43.703], [7.02, 43.55], [6.50, 43.35], [5.93, 43.12], [5.37, 43.30],
        [4.90, 43.60], [4.83, 45.76], [3.90, 47.30], [2.352, 48.857]
      ]],
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

  /* =============================================================
     手绘地标图标（48×48 网格 · 纯描边）
     -------------------------------------------------------------
     设计取舍：图标本身画得规整，「手绘感」交给 SVG 的 feDisplacementMap
     做轻微抖动 —— 路线层整组套 #dm-rough-s，线和图标拿到的是同一种抖动。
     直接手写出歪扭的路径既难维护，缩小后也只会糊成一团；而滤镜的位移量
     是跟着坐标系一起缩的，观感才稳。
     描边宽度统一由 CSS 的 .dm-ico 给，不在这里写死。
     ============================================================= */
  var ICO = {
    /* 圣家堂：四座高低错落的尖塔 */
    sagradafamilia:
      '<path d="M11 40L14 20l3 20z"/><path d="M18 40L21 15l3 25z"/>' +
      '<path d="M25 40L28 13l3 27z"/><path d="M32 40L35 24l3 16z"/>' +
      '<path d="M21 15v-4M19 12h4"/><path d="M28 13v-4M26 10h4"/>' +
      '<path d="M8 40h32"/><path d="M12 34h24"/><path d="M21 40v-6a3 3 0 0 1 6 0v6"/>',

    /* 桂尔公园：波浪长椅 + 小太阳 */
    parkguell:
      '<path d="M7 33q5.5-7 11 0t11 0t11 0"/><path d="M7 33q5.5 7 11 0t11 0t11 0"/>' +
      '<path d="M12 38v4M24 40v3M36 38v4"/>' +
      '<circle cx="36" cy="12" r="4"/><path d="M36 5v2M36 17v2M30 12h-2M42 12h2"/>',

    /* 加泰音乐宫：拱形立面 + 玫瑰窗 */
    palau:
      '<path d="M9 40V26a15 15 0 0 1 30 0v14"/><path d="M16 40V28M24 40V26M32 40V28"/>' +
      '<circle cx="24" cy="18" r="4.5"/><path d="M6 40h36"/>',

    /* 圣保罗医院：穹顶 + 十字 + 拱廊 */
    santpau:
      '<path d="M14 21a10 10 0 0 1 20 0"/><path d="M17 21h14v5H17z"/>' +
      '<path d="M24 10V6M21 8h6"/><path d="M9 40V26h30v14"/>' +
      '<path d="M14 40v-7a3.5 3.5 0 0 1 7 0v7"/><path d="M27 40v-7a3.5 3.5 0 0 1 7 0v7"/>' +
      '<path d="M6 40h36"/>',

    /* 卢浮宫：玻璃金字塔 */
    louvre:
      '<path d="M24 8L40 38H8z"/><path d="M24 8v30"/>' +
      '<path d="M16 23h16"/><path d="M12 31h24"/><path d="M5 38h38"/>',

    /* 奥赛博物馆：火车站大钟 */
    orsay:
      '<path d="M8 40V28a16 16 0 0 1 32 0v12"/>' +
      '<circle cx="24" cy="22" r="6"/><path d="M24 22v-4M24 22l3.5 2"/>' +
      '<path d="M14 40v-8a3 3 0 0 1 6 0v8"/><path d="M28 40v-8a3 3 0 0 1 6 0v8"/>' +
      '<path d="M5 40h38"/>',

    /* 凡尔赛：宫殿立面 + 烟囱 */
    versailles:
      '<path d="M6 26l4-7h28l4 7"/><path d="M10 26v14h28V26"/>' +
      '<path d="M15 40v-8a3.5 3.5 0 0 1 7 0v8"/><path d="M26 40v-8a3.5 3.5 0 0 1 7 0v8"/>' +
      '<path d="M14 19v-4h3v4M31 19v-4h3v4"/><path d="M5 40h38"/>',

    /* 加尼叶歌剧院：圆顶 + 三联拱 */
    opera:
      '<path d="M24 13a9 9 0 0 1 9 9h-18a9 9 0 0 1 9-9"/>' +
      '<path d="M8 40V22h32v18"/>' +
      '<path d="M13 40v-9a3.5 3.5 0 0 1 7 0v9"/><path d="M20.5 40v-9a3.5 3.5 0 0 1 7 0v9"/>' +
      '<path d="M28 40v-9a3.5 3.5 0 0 1 7 0v9"/>' +
      '<path d="M24 13V8M21 10h6"/><path d="M5 40h38"/>',

    /* 橘园：圆形展厅 + 睡莲 */
    orangerie:
      '<circle cx="24" cy="22" r="11"/><path d="M13 33v7M35 33v7M13 33h22"/>' +
      '<path d="M17 28q3.5-4 7 0"/><path d="M24 28q3.5-4 7 0"/>' +
      '<path d="M24 11V7"/><path d="M6 40h36"/>',

    /* 先贤祠：穹顶 + 柱廊 */
    pantheon:
      '<path d="M13 20a11 11 0 0 1 22 0"/><path d="M15 20h18v5H15z"/>' +
      '<path d="M8 26h32"/><path d="M12 40V26M18 40V26M24 40V26M30 40V26M36 40V26"/>' +
      '<path d="M24 9V5M21 7h6"/><path d="M5 40h38"/>',

    /* 圣心堂：洋葱穹顶 + 拱门 */
    sacrecoeur:
      '<path d="M24 12a10 10 0 0 1 10 10H14a10 10 0 0 1 10-10"/>' +
      '<path d="M24 12V7M20 9h8"/><path d="M9 40V26h30v14"/>' +
      '<path d="M13 40v-8a3 3 0 0 1 6 0v8"/><path d="M21 40v-8a3 3 0 0 1 6 0v8"/>' +
      '<path d="M29 40v-8a3 3 0 0 1 6 0v8"/><path d="M5 40h38"/>',

    /* 地下墓穴：拱门 + 头骨（眼睛用短笔画，保持全图纯描边） */
    catacombes:
      '<path d="M9 40V33a15 15 0 0 1 30 0v7"/><path d="M17 40V36a7 7 0 0 1 14 0v4"/>' +
      '<path d="M24 19a5 5 0 0 1 5 5v3h-10v-3a5 5 0 0 1 5-5z"/>' +
      '<path d="M21.6 22.4v1.7M26.4 22.4v1.7"/><path d="M22 27h4"/><path d="M5 40h38"/>',

    /* 通用 · 教堂（哥特区 / 大教堂 / 西岱岛） */
    church:
      '<path d="M24 7V4M21 5.5h6"/><path d="M24 9L37 24H11z"/>' +
      '<path d="M15 24v16h18V24"/><path d="M21 40v-9a3.5 3.5 0 0 1 6 0v9"/>' +
      '<path d="M18 28v4M30 28v4"/><path d="M6 40h36"/>',

    /* 通用 · 城堡（蒙特惠奇 / 城堡山 / Antibes / Crémat） */
    castle:
      '<path d="M10 40V20h4v-5h4v5h4v-6h4v6h4v-5h4v5h4v20z"/>' +
      '<path d="M21 40v-8a3 3 0 0 1 6 0v8"/><path d="M6 40h36"/>',

    /* 通用 · 海滩 */
    beach:
      '<path d="M11 23Q24 7 37 23"/><path d="M37 23q-3.25 3-6.5 0t-6.5 0t-6.5 0t-6.5 0"/>' +
      '<path d="M24 23v13"/><path d="M8 38q4-4 8 0t8 0t8 0"/>',

    /* 通用 · 市集（圣卡特琳娜 / Cours Saleya / Portal de l'Àngel） */
    market:
      '<path d="M8 18h32l-4 7H12z"/><path d="M16 18v7M24 18v7M32 18v7"/>' +
      '<path d="M12 25v13M36 25v13"/>' +
      '<path d="M17 31h6v6h-6z"/><path d="M25 31h6v6h-6z"/><path d="M6 40h36"/>',

    /* 通用 · 港口（锚） */
    port:
      '<circle cx="24" cy="13" r="4"/><path d="M24 17v20"/><path d="M16 25h16"/>' +
      '<path d="M11 30q13 12 26 0"/><path d="M8 27l5 3-5 3"/><path d="M40 27l-5 3 5 3"/>',

    /* 通用 · 公园 / 林荫（两棵树） */
    park:
      '<circle cx="19" cy="21" r="8"/><path d="M19 29v11"/>' +
      '<circle cx="32" cy="28" r="5.5"/><path d="M32 33v7"/><path d="M6 40h36"/>',

    /* 通用 · 山丘（蒙马特 / 海岸小径） */
    hill:
      '<path d="M6 40l12-17 8 11 5-7 11 13z"/><circle cx="34" cy="13" r="4"/><path d="M5 40h38"/>',

    /* 通用 · 老城屋顶（老城 / 玛黑 / 拉丁区） */
    town:
      '<path d="M7 40V31l6-6 6 6v9"/><path d="M18 40V26l7-7 7 7v14"/>' +
      '<path d="M31 40V33l5-5 5 5v7"/>' +
      '<path d="M11 34h4v4h-4z"/><path d="M22 30h4v4h-4z"/><path d="M5 40h38"/>',

    /* 通用 · 宫殿（MNAC / 海军府 / 毕加索馆） */
    palace:
      '<path d="M8 40V25h32v15"/><path d="M4 25L24 12l20 13"/>' +
      '<path d="M14 40V29M20 40V29M28 40V29M34 40V29"/><path d="M6 40h36"/>',

    /* 魔幻喷泉（Maria Cristina 舞台） */
    fountain:
      '<path d="M24 8v8"/><path d="M13 24q11-8 22 0"/><path d="M9 32q15 10 30 0"/>' +
      '<path d="M16 20l-4-5M32 20l4-5"/><path d="M18 36q6 4 12 0"/><path d="M6 40h36"/>',

    /* 威尼斯双塔（西班牙广场） */
    torres:
      '<path d="M11 40V18l3-5 3 5v22"/><path d="M31 40V18l3-5 3 5v22"/>' +
      '<path d="M11 24h6M31 24h6"/><path d="M24 40v-6"/><path d="M18 34q6 5 12 0"/>' +
      '<path d="M6 40h36"/>',

    /* 机场（BCN T1 / CDG T2C） */
    plane:
      '<path d="M24 6a2.5 2.5 0 0 1 2.5 2.5V15l11.5 6v3.5L26 21.5v5l4 3v3l-6-2-6 2v-3l4-3v-5L10.5 24.5V21l11.5-6V8.5A2.5 2.5 0 0 1 24 6z"/>'
  };

  /* ---------- 地点 → 图标 ----------
   * 只有「值得认出来」的地点给图标；酒店 / 民宿 / 公寓 / 地铁站一律保持
   * 普通编号圆点 —— 全画上图会失去层次，图标也就白给了。
   */
  var LANDMARK = {
    // 巴塞罗那
    'BCN T1': ICO.plane,
    '西班牙广场': ICO.torres,
    'Maria Cristina 舞台': ICO.fountain,
    '哥特区': ICO.church,
    '毕加索馆': ICO.palace,
    '大教堂': ICO.church,
    'Bogatell 海滩': ICO.beach,
    'Barceloneta 海滩': ICO.beach,
    '圣卡特琳娜市场': ICO.market,
    "Portal de l'Àngel": ICO.market,
    '兰布拉': ICO.park,
    '桂尔公园': ICO.parkguell,
    '圣保罗医院': ICO.santpau,
    '圣家堂': ICO.sagradafamilia,
    '音乐宫': ICO.palau,
    '蒙特惠奇城堡': ICO.castle,
    '山地花园': ICO.park,
    'MNAC': ICO.palace,
    // 尼斯 / 昂蒂布
    '老城': ICO.town,
    'Cours Saleya': ICO.market,
    'Plage Beau Rivage': ICO.beach,
    '老港': ICO.port,
    '港口': ICO.port,
    '城堡山': ICO.castle,
    'Antibes 老城': ICO.town,
    'Sentier du Littoral': ICO.hill,
    'Château de Crémat': ICO.castle,
    // 巴黎
    '奥赛博物馆': ICO.orsay,
    '凡尔赛': ICO.versailles,
    'Catacombes': ICO.catacombes,
    '西岱岛': ICO.church,
    '拉丁区': ICO.town,
    'Opéra Garnier': ICO.opera,
    '橘园': ICO.orangerie,
    '海军府(弹性)': ICO.palace,
    '卢浮宫': ICO.louvre,
    '卢森堡公园': ICO.park,
    '先贤祠': ICO.pantheon,
    '玛黑区': ICO.town,
    '蒙马特': ICO.hill,
    '圣心大教堂': ICO.sacrecoeur,
    'CDG T2C': ICO.plane
  };

  /* ---------- 路线层参数（G 方案：手绘底图 × 地铁线路语法） ----------
   * 颜色一律走 CSS 变量（见 index.html 的 .dm-* 规则），这里只放尺寸。
   * 这样深色模式换一套变量就够了，JS 不用分叉。
   */
  var OPTS = {
    casingW: 15, casingFarW: 12,     // 纸色套管：让线在花底图上也能读清
    lineW: 6.5, lineFarW: 3.6,       // 主线 / 长途段
    stationR: 11.5,                  // 普通车站半径
    lmR: 16,                         // 地标纸片半径
    badgeR: 7.6, badgeOff: 13,       // 地标右下角的编号徽章
    icoScale: 0.64,                  // 48 网格缩到 30.7 单位
    labelSize: 17, cjkW: 16, latinW: 8.6,
    labelGap: 13,                    // 标签离节点边缘的距离
    /* 摊开重叠点时两个节点之间额外留的空隙。设 12 不是审美选择：热区半径取
       「到最近邻距离的一半」，普通点对 = 12.5+12.5+12 = 37，热区 r≈18.5；
       手机上卡片内容宽约 350px 对 viewBox 440，缩放 0.8，得 30px 直径。
       再往上加会让点飘离真实位置太远、标签也更难放。 */
    spreadGap: 12
  };

  /* 全站标签开关：true = 每个点都写地名；false = 只写起点和终点。
     某天太挤时，可以在 DAYS 里给那一天加 mapLabels:'ends' 单独切回。 */
  var ALL_LABELS = true;

  /* ---------- 全局滤镜 ----------
   * 12 张图共用一份 defs：用一个 0 尺寸的隐藏 SVG 挂在 body 上，
   * 各图用 url(#id) 引用。每图各写一份会重复 12 次 id，没必要。
   */
  var NS = 'http://www.w3.org/2000/svg';
  var DEFILTERS =
    '<defs>' +
    '<filter id="dm-rough" x="-20%" y="-20%" width="140%" height="140%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="7" result="n"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G"/>' +
    '</filter>' +
    '<filter id="dm-rough-s" x="-20%" y="-20%" width="140%" height="140%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="11" result="n2"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="n2" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>' +
    '</filter>' +
    '<filter id="dm-soft" x="-30%" y="-30%" width="160%" height="160%">' +
      '<feGaussianBlur stdDeviation="6"/></filter>' +
    '<filter id="dm-soft2" x="-40%" y="-40%" width="180%" height="180%">' +
      '<feGaussianBlur stdDeviation="14"/></filter>' +
    '<filter id="dm-grain" x="0" y="0" width="100%" height="100%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" stitchTiles="stitch"/>' +
      '<feColorMatrix type="saturate" values="0"/>' +
      '<feComponentTransfer><feFuncA type="linear" slope="0.55"/></feComponentTransfer>' +
    '</filter>' +
    '</defs>';

  function ensureDefs() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('dm-defs')) return;
    var host = document.body || document.documentElement;
    if (!host) return;
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('id', 'dm-defs');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
    s.innerHTML = DEFILTERS;
    host.appendChild(s);
  }

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
  function spreadOverlaps(pts, gap, bounds) {
    var n = pts.length;
    if (n < 2) return;
    /* 需要的间距按两个节点各自的半径算：地标贴纸（约 20）比普通车站（约 12）
       大一圈，用同一个固定值会让贴纸叠在一起。 */
    function need(i, j) { return (pts[i].r || 12) + (pts[j].r || 12) + gap; }
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
          var minD = need(i, j);
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
        // 贴纸自己也不能出画布；bounds.pad 是给标签留的余量，两者取大的
        var p = Math.max(bounds.pad, (pts[i].r || 12) + 2);
        pts[i].x = Math.max(p, Math.min(bounds.w - p, pts[i].x));
        pts[i].y = Math.max(p, Math.min(bounds.h - p, pts[i].y));
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

  /* 45° 折线：min(|dx|,|dy|) 走斜段，其余走直段 —— 标准轨道交通图画法。
     直连斜线在密集日会互相穿插成一张网，折成 45° 之后每条边只有横/竖/斜三种
     走向，先后顺序一眼能顺着读下来。 */
  function elbow(x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var adx = Math.abs(dx), ady = Math.abs(dy);
    var sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    if (adx < 1 || ady < 1) {
      return 'M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + 'L' + x2.toFixed(1) + ' ' + y2.toFixed(1);
    }
    if (adx >= ady) {
      return 'M' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
        'H' + (x1 + sx * (adx - ady)).toFixed(1) +
        'L' + x2.toFixed(1) + ' ' + y2.toFixed(1);
    }
    return 'M' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
      'V' + (y1 + sy * (ady - adx)).toFixed(1) +
      'L' + x2.toFixed(1) + ' ' + y2.toFixed(1);
  }

  function labelWidth(name, o) {
    var w = 0;
    for (var i = 0; i < name.length; i++) {
      w += name.charCodeAt(i) > 255 ? o.cjkW : o.latinW;   // 中日韩按一个字宽，西文按半宽
    }
    return w;
  }

  /* 候选位置 = 左右两侧 × 上下多档偏移，逐个试到既不撞已放好的标签、
     也不压住别的节点（含地标右下角的编号徽章）为止。
     最早是固定「看 x 决定左右、看 y 决定上下」两条规则，实测 D4/D12 的起点标签
     会正好糊在 3 号/4 号圆上——两个点落在同一侧时，这个简单规则必然撞车。
     后来改多候选但只往下挪，D9 六站挤在拉丁区时撞完所有档、整条漏标；
     必须允许翻到另一侧才有解。
     放不下就跳过：硬塞只会糊在节点上，比不画更糟——地名在下方清单里一份不少。 */
  var LABEL_DY = [0, 19, -19, 38, -38, 57, -57, 76, -76, 95, -95, 114, -114];

  /* placed 由调用方持有并传进来：正常轮和放宽轮要共享同一份已占区域，
     否则第二轮会把标签压在第一轮上。
     force=true 是第三轮兜底：连放宽都塞不下时，挑「压得最轻」的那个位置硬放。
     整条漏标的观感比轻微压线更糟——地名在清单里有，但图上少一个就会被人当成 bug。 */
  function placeLabels(items, obs, vb, o, relax, placed, force) {
    var res = [];
    var padX = relax ? 1 : 5, padY = relax ? 1 : 3, clear = relax ? 1 : 6;
    var dys = relax ? LABEL_DY.concat([133, -133, 152, -152]) : LABEL_DY;
    items.forEach(function (it) {
      var w = labelWidth(it.name, o);
      var pref = it.x < vb.w / 2 ? 1 : -1;   // 先试朝画面中心的那一侧，空间更大
      var cands = [];
      [pref, -pref].forEach(function (side) {
        dys.forEach(function (dy) { cands.push({ side: side, dy: dy }); });
      });
      // 正上 / 正下居中：长地名在 440 宽的画布上，两侧都伸出去时常常只剩这一处
      cands.push({ side: 0, dy: -(it.r + 26) });
      cands.push({ side: 0, dy: it.r + 36 });

      var got = null, best = null, bestPen = Infinity;
      for (var c = 0; c < cands.length && !got; c++) {
        var side = cands[c].side;
        var anchor = side < 0 ? 'end' : (side > 0 ? 'start' : 'middle');
        var tx = it.x + side * (it.r + o.labelGap);
        var ty = it.y + 5 + cands[c].dy;
        var x0 = anchor === 'end' ? tx - w : (anchor === 'middle' ? tx - w / 2 : tx);
        var x1 = x0 + w;
        var y0 = ty - 13, y1 = ty + 6;
        if (x0 < 4 || x1 > vb.w - 4 || y0 < 2 || y1 > vb.h - 2) continue;
        var pen = 0, m, hit = false;
        for (m = 0; m < placed.length; m++) {
          var p = placed[m];
          var ox = Math.min(x1, p.x1) - Math.max(x0, p.x0) + padX;
          var oy = Math.min(y1, p.y1) - Math.max(y0, p.y0) + padY;
          if (ox > 0 && oy > 0) { hit = true; pen += ox * oy; }
        }
        for (m = 0; m < obs.length; m++) {
          if (obs[m].k === it.i) continue;                 // 自己的节点和徽章不算障碍
          var nx = Math.max(x0, Math.min(obs[m].x, x1));
          var ny = Math.max(y0, Math.min(obs[m].y, y1));
          var d = Math.hypot(obs[m].x - nx, obs[m].y - ny);
          if (d < obs[m].r + clear) { hit = true; pen += (obs[m].r + clear - d) * 20; }
        }
        if (!hit) {
          got = { tx: tx, ty: ty, anchor: anchor };
          placed.push({ x0: x0, x1: x1, y0: y0, y1: y1 });
        } else if (pen < bestPen) {
          bestPen = pen;
          best = { tx: tx, ty: ty, anchor: anchor, x0: x0, x1: x1, y0: y0, y1: y1 };
        }
      }
      if (!got && force && best) {
        got = { tx: best.tx, ty: best.ty, anchor: best.anchor };
        placed.push({ x0: best.x0, x1: best.x1, y0: best.y0, y1: best.y1 });
      }
      if (got) res.push({ i: it.i, tx: got.tx, ty: got.ty, anchor: got.anchor });
    });
    return res;
  }

  /* 生成一天地图的 HTML（SVG + 下方可点清单） */
  function render(day) {
    var parsed = parseRoute(day.route);
    var stops = parsed.stops;
    if (stops.length < 2) return '';

    ensureDefs();
    var base = pickBase(stops);
    /* viewBox 宽度 440：手机上卡片内宽约 300px，缩放约 0.68。
       这个比例下普通车站直径约 16px、地标贴纸约 27px、r=30 的透明热区约 41px，
       刚好跨过 40px 触控标准。改这个数时要同时复核那三个值。 */
    var OUT_W = 440;
    var v = makeView(stops, OUT_W);
    var o = OPTS;
    var col = day.color || 'var(--accent)';

    // 屏幕坐标：重叠点先摊开。底图的 notes 冲突检测、连线和圆点都读这一份，
    // 保证「同一个点在图上只有一个位置」。
    // r 是「排布半径」：地标贴纸连同右下角的编号徽章约占 20，普通车站 12.5。
    var pts = stops.map(function (s) {
      var ico = LANDMARK[s.name] || null;
      return { x: v.X(s.lon), y: v.Y(s.lat), ico: ico, r: ico ? o.lmR + 4 : o.stationR + 1 };
    });
    // 夹取边距 40：节点半径 + 标签往外伸 30 多，贴着 34 的话标签必然出界
    spreadOverlaps(pts, o.spreadGap, { pad: 40, w: OUT_W, h: v.h });

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
      var seaD = linePath(seaPoly(base.coast, base.seaSide, D), v) + 'Z';
      /* 水彩感：在海面之上叠两层高斯模糊的副本，把硬边晕开。
         顺序是先大模糊后小模糊，大的当底色晕圈，小的补一层近岸的浓一点的水色。 */
      svg.push('<path class="dm-sea dm-sea-blur2" d="' + seaD + '" filter="url(#dm-soft2)"/>');
      svg.push('<path class="dm-sea dm-sea-blur1" d="' + seaD + '" filter="url(#dm-soft)"/>');
      svg.push('<path class="dm-sea" d="' + seaD + '"/>');
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
    /* 纸纹铺在底图墨线之上、路线层之下：物理上纸纹本来就该在墨下面，
       但那样会被海面和陆地的实色盖掉；压在底图上、让路线层再盖上去，
       既看得到颗粒又不糊住要读的字。 */
    svg.push('<rect class="dm-grain" x="0" y="0" width="' + OUT_W + '" height="' + v.h.toFixed(0) +
      '" filter="url(#dm-grain)"/>');
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

    /* ---- 路线层：地铁语法 ----
       分两个图层：dm-rough 套一层极轻的抖动滤镜（线和图标一起抖，手绘味从这里来），
       dm-ink 不加滤镜 —— 编号和地名必须保持清晰，抖过小字会糊。 */
    var rough = [], ink = [], hits = [];

    // 1) 连线：45° 折线，先铺纸色套管再压彩色主线
    parsed.legs.forEach(function (leg) {
      var a = pts[leg.a], b = pts[leg.b];
      var d = elbow(a.x, a.y, b.x, b.y);
      var far = leg.kind !== 'walk';
      rough.push('<path class="dm-mc" d="' + d + '" stroke-width="' + (far ? o.casingFarW : o.casingW) + '"/>');
      rough.push('<path class="dm-ml' + (far ? ' dm-ml-far' : '') + '" d="' + d +
        '" stroke="' + col + '" stroke-width="' + (far ? o.lineFarW : o.lineW) + '"/>');

      if (leg.label) {
        // 交通段：中点贴一张小纸片写车次
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var txt = (leg.kind === 'rail' ? '🚄' : '✈') + ' ' + leg.label;
        var wpx = labelWidth(txt, o) + 20;
        ink.push('<g class="dm-mchip">' +
          '<rect x="' + (mx - wpx / 2).toFixed(1) + '" y="' + (my - 13).toFixed(1) +
          '" width="' + wpx.toFixed(1) + '" height="26" rx="7"/>' +
          '<text x="' + mx.toFixed(1) + '" y="' + (my + 6).toFixed(1) + '" text-anchor="middle">' +
          esc(txt) + '</text></g>');
      } else if (leg.kind === 'air') {
        ink.push('<text class="dm-fly" x="' + ((a.x + b.x) / 2).toFixed(1) +
          '" y="' + ((a.y + b.y) / 2 - 12).toFixed(1) + '" text-anchor="middle">✈</text>');
      }
    });

    // 2) 节点：地标 = 纸片 + 手绘图标 + 编号徽章；普通点 = 空心车站 + 编号
    //    obs 同时收集所有占位（节点本体 + 徽章），供标签避让用
    var obs = [];
    pts.forEach(function (p, i) {
      var x = p.x, y = p.y;
      obs.push({ x: x, y: y, r: p.r, k: i });
      if (p.ico) {
        var s = o.icoScale, off = 24 * s;
        rough.push('<circle class="dm-lmb" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + o.lmR + '"/>');
        rough.push('<g class="dm-ico" transform="translate(' + (x - off).toFixed(1) + ',' + (y - off).toFixed(1) +
          ') scale(' + s + ')" stroke="' + col + '">' + p.ico + '</g>');
        // 徽章压在纸片右下角、一半探出去，像贴在手册上的编号贴
        var bx = x + o.badgeOff, by = y + o.badgeOff;
        obs.push({ x: bx, y: by, r: o.badgeR, k: i });
        ink.push('<circle class="dm-bdg" cx="' + bx.toFixed(1) + '" cy="' + by.toFixed(1) +
          '" r="' + o.badgeR + '" fill="' + col + '"/>');
        ink.push('<text class="dm-bdgn" x="' + bx.toFixed(1) + '" y="' + (by + 3.4).toFixed(1) +
          '" text-anchor="middle">' + (i + 1) + '</text>');
      } else {
        rough.push('<circle class="dm-ms" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) +
          '" r="' + o.stationR + '" stroke="' + col + '"/>');
        ink.push('<text class="dm-mno" x="' + x.toFixed(1) + '" y="' + (y + 4.4).toFixed(1) +
          '" text-anchor="middle" fill="' + col + '">' + (i + 1) + '</text>');
      }
    });

    // 3) 地名：默认每个点都写（这是 G 方案相对旧版最大的可读性提升）。
    //    起点终点先挑位置 —— 它们是最该被读到的两个，不能让中间站先把好位置占了。
    //    哪天觉得太满，在 DAYS 里给那天加 mapLabels:'ends' 就退回只标首尾。
    var showAll = ALL_LABELS && day.mapLabels !== 'ends';
    var items = [], oi;
    var order = [0, stops.length - 1];
    for (oi = 1; oi < stops.length - 1; oi++) order.push(oi);
    order.forEach(function (i) {
      if (!showAll && i !== 0 && i !== stops.length - 1) return;
      items.push({ i: i, x: pts[i].x, y: pts[i].y, r: pts[i].r, name: stops[i].name });
    });
    var vb = { w: OUT_W, h: v.h }, placed = [];
    var labels = placeLabels(items, obs, vb, o, false, placed);
    if (labels.length < items.length) {
      /* 兜底一轮：把间距放宽到几乎相接，再往外多试两档。
         标签外面有 5 单位纸色描边，轻微相接仍然读得清；
         全放不下才真的放弃 —— 那时硬塞只会糊成一团，不如留给下方清单。 */
      var done = {};
      labels.forEach(function (L) { done[L.i] = 1; });
      labels = labels.concat(placeLabels(items.filter(function (it) {
        return !done[it.i];
      }), obs, vb, o, true, placed, false));
    }
    if (labels.length < items.length) {
      /* 最后一轮：放宽轮还没吃下的（如 D5 的「大教堂」），挑压得最轻的位置硬放。 */
      var done2 = {};
      labels.forEach(function (L) { done2[L.i] = 1; });
      labels = labels.concat(placeLabels(items.filter(function (it) {
        return !done2[it.i];
      }), obs, vb, o, true, placed, true));
    }
    labels.forEach(function (L) {
      ink.push('<text class="dm-lbl" x="' + L.tx.toFixed(1) + '" y="' + L.ty.toFixed(1) +
        '" text-anchor="' + L.anchor + '">' + esc(stops[L.i].name) + '</text>');
    });

    // 4) 点击热区单独一层压在最上面。半径按最近邻距离收缩：一律 30 的话，
    //    密集日的热区会互相盖住，点 3 号跳到 4 号。
    stops.forEach(function (s, i) {
      var x = pts[i].x, y = pts[i].y, near = Infinity;
      for (var m = 0; m < pts.length; m++) {
        if (m === i) continue;
        near = Math.min(near, Math.hypot(pts[m].x - x, pts[m].y - y));
      }
      // 半径取到最近邻距离的一半：热区不重叠，点 3 号不会跳到 4 号。
      // 下限 24（手机约 38px 直径）而不是 15 —— 15 只有 24px，手指点不中。
      // 真被夹到下限时会和邻居轻微重叠，此时 DOM 里靠后的站点赢，
      // 量级只在几像素，误触概率远低于「点不中」。
      var hr = Math.max(24, Math.min(30, near / 2));
      hits.push('<a class="dm-node" href="' + esc(gmapUrl(s.q)) + '" target="_blank" rel="noopener">' +
        '<circle class="dm-hit" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + hr.toFixed(1) + '"/>' +
        '</a>');
    });

    svg.push('<g class="dm-rough" filter="url(#dm-rough-s)">' + rough.join('') + '</g>');
    svg.push('<g class="dm-ink">' + ink.join('') + '</g>');
    svg.push('<g class="dm-hits">' + hits.join('') + '</g>');

    svg.push('</svg>');

    // ---- 下方清单：编号与地图一一对应，每个可点开地图 ----
    var list = stops.map(function (s, i) {
      return '<a class="dm-item' + (LANDMARK[s.name] ? ' is-lm' : '') +
        '" href="' + esc(gmapUrl(s.q)) + '" target="_blank" rel="noopener">' +
        '<span class="dm-item-n" style="background:' + col + '">' + (i + 1) + '</span>' +
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
