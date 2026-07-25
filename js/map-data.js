/**
 * 正式案件地图数据
 * 坐标基于 MAP_WIDTH x MAP_HEIGHT 画布（横向长方形）
 * connections 为相邻可达站点 id 列表（无向图，供移动逻辑使用；地图上不再绘制连线）
 */
/** 百度卫星底图（广州市区离线拼接），仅视觉层，不影响格点坐标 */
export const MAP_IMAGE = '/data/images/maps/guangzhou-sat.jpg?v=20260725-expand';

/** 画布尺寸（扩展后）：底图覆盖 480x300，游戏区域 320x200 居中 */
export const MAP_WIDTH = 480;
export const MAP_HEIGHT = 300;

/** 游戏核心区域偏移量（让原 320x200 区域在扩展画布中居中） */
export const CORE_OFFSET_X = 80;
export const CORE_OFFSET_Y = 50;

/**
 * 五区无缝拼接（共享边顶点完全一致，铺满画布无缝隙）
 * 共享边：
 * 西∩好 (72,40)-(100,56) | 好∩中 (100,56)-(176,56) | 好∩圣 (218,0)-(218,48)
 * 西∩中 (100,56)-(100,116) | 西∩南 (100,116)-(72,140)-(20,136)-(0,120)
 * 中∩圣 (226,76)-(222,132) | 中∩南 (100,116)-(128,130)-(176,138)-(222,132)
 * 南∩圣 (222,132)-(227,200)
 */
export const DISTRICTS = [
  {
    id: 'west',
    name: '西区',
    color: '#38bdf8',
    points: '2.5,40.0 72.0,40.0 100.0,56.0 100.0,116.0 72.0,130.0 20.0,136.0 0.0,120.0 2.8,108.0 0.5,92.0 3.0,76.0 1.0,60.0 2.5,40.0',
  },
  {
    id: 'hollywood',
    name: '好莱坞',
    color: '#f59e0b',
    points: '20,-10 55.0,-12.0,-5.0 105.0,1.2 148.0,-10 218.0,-2.0 218.0,48.0 176.0,56.0 100.0,56.0 72.0,40.0 36.0,40.0 36.0,20.0',
  },
  {
    id: 'central',
    name: '洛杉矶中央城区',
    color: '#a78bfa',
    points: '100.0,56.0 176.0,56.0 226.0,76.0 222.0,132.0 176.0,138.0 128.0,130.0 100.0,116.0',
  },
  {
    id: 'south',
    name: '南湾',
    color: '#22c55e',
    points: '20.0,136.0 72.0,130.0 100.0,116.0 128.0,130.0 176.0,138.0 222.0,132.0 247.0,150.0 187.0,172.0 175.0,197.5 148.0,200.8 108.0,198.2 68.0,190.0 50.0,178.8',
  },
  {
    id: 'gabriel',
    name: '圣盖博谷',
    color: '#ef4444',
    points: '218.0,-2.0 260,-35 310.0,10.0 322.5,42.0 324.5,65.0 320.5,85.0 338.0,125.0 321.0,165.0 247.0,150.0 222.0,132.0 226.0,76.0 218.0,48.0',
  },
];

/**
 * 站点数据
 * - districts: 所属区域（边界点可含 2~3 个）
 * - district: 主区（取 districts[0]，兼容旧逻辑）
 *
 * 交界点：
 * 西区∩好莱坞 8,17 | 西区∩南湾 16,23 | 西区∩中央 19,22
 * 好莱坞∩中央 38,45,52 | 好莱坞∩圣盖博谷 58,59
 * 圣盖博谷∩中央 53,56,57,98 | 南湾∩中央 82,91,96,98
 * 98 为三区交界（圣盖博谷∩中央∩南湾）
 * 校正：90/92/97 仅南湾；54/55 仅中央
 *
 * 特殊地点：
 * 警局 police：4,12,27,36,51,63,72,84,95（出生点仅可选警局）
 * 黑帮 gang：9,22,34,52,71,76,96
 */
export const POLICE_STATION_IDS = [4, 12, 27, 36, 51, 63, 72, 84, 95];
export const GANG_STATION_IDS = [9, 22, 34, 52, 71, 76, 96];

const POLICE_SET = new Set(POLICE_STATION_IDS);
const GANG_SET = new Set(GANG_STATION_IDS);

export const STATIONS = [
  { id: 1, name: '加利福尼亚大学', districts: ['west'], x: 44.7, y: 99.4 },
  { id: 2, name: '植物园', districts: ['west'], x: 14.7, y: 69.3 },
  { id: 3, name: '西木村', districts: ['west'], x: 39.5, y: 73.7 },
  { id: 4, name: '西区警局', districts: ['west'], x: 25.0, y: 87.5 },
  { id: 5, name: '威尔夏大道', districts: ['west'], x: 4.9, y: 86.8 },
  { id: 6, name: '海洋公园休闲码头', districts: ['west'], x: 9.5, y: 106.4 },
  { id: 7, name: '码头大道', districts: ['west'], x: 29.4, y: 108.3 },
  // 西区 ∩ 好莱坞 —— 边 (72,40)-(100,56)
  { id: 8, name: '比佛利山庄酒店', districts: ['west', 'hollywood'], x: 62.9, y: 40.1 },
  { id: 9, name: '斯兰帕西·马克西夜总会', districts: ['west'], x: 55.4, y: 60.8 },
  { id: 10, name: '拉布雷亚沥青坑', districts: ['west'], x: 73.9, y: 68.2 },
  { id: 11, name: '福克斯制片厂', districts: ['west'], x: 58.2, y: 80.7 },
  { id: 12, name: '威尔夏警局', districts: ['west'], x: 76.4, y: 89.0 },
  { id: 13, name: '三叶草花田机场', districts: ['west'], x: 29.8, y: 56.1 },
  { id: 14, name: '华盛顿大道', districts: ['west'], x: 62.9, y: 103.8 },
  { id: 15, name: '日落码头', districts: ['west'], x: 47.6, y: 126.7 },
  // 西区 ∩ 南湾 —— 边 (100,116)-(72,140)-(20,136)-(0,120)
  { id: 16, name: '曼彻斯特大道', districts: ['west', 'south'], x: 50.0, y: 141.3 },
  // 西区 ∩ 好莱坞 —— 角点 (100,56)
  { id: 17, name: '乡村庄园俱乐部', districts: ['west', 'hollywood'], x: 92.1, y: 50.0 },
  { id: 18, name: '西大街和威尔夏大道', districts: ['west'], x: 92.1, y: 76.7 },
  // 西区 ∩ 中央城区 —— 边 (100,56)-(100,116)
  { id: 19, name: '洛约拉高级中学', districts: ['west', 'central'], x: 100.0, y: 94.0 },
  { id: 20, name: '麦卡蒂基督教纪念堂', districts: ['west'], x: 83.0, y: 105.4 },
  { id: 21, name: '克伦肖大道和圣巴巴拉大道', districts: ['west'], x: 70.5, y: 117.1 },
  // 西区 ∩ 中央城区 —— 边 (100,56)-(100,116)
  { id: 22, name: '雄鹿与公牛俱乐部', districts: ['west', 'central'], x: 100.0, y: 110.0 },
  // 西区 ∩ 南湾 —— 近 (100,116)
  { id: 23, name: '英格尔伍德公墓', districts: ['west', 'south'], x: 88.0, y: 121.8},
  { id: 24, name: '好莱坞露天剧场', districts: ['hollywood'], x: 90.5, y: 13.3 },
  { id: 25, name: '格劳曼中国剧院', districts: ['hollywood'], x: 72.8, y: 27.2 },
  { id: 26, name: '马尔蒙庄园酒店', districts: ['hollywood'], x: 109.8, y: 42.1 },
  { id: 27, name: '好莱坞警局', districts: ['hollywood'], x: 55.4, y: 5.2 },
  { id: 28, name: '西大街和洛斯费利兹大道', districts: ['hollywood'], x: 108.5, y: 17.9 },
  { id: 29, name: '好莱坞山标志牌', districts: ['hollywood'], x: 119.2, y: 5.2 },
  { id: 30, name: '格里菲斯公园', districts: ['hollywood'], x: 137.1, y: 14.0 },
  { id: 31, name: '诺曼底大道和比佛利大道', districts: ['hollywood'], x: 195.0, y: 37.8 },
  { id: 32, name: '弗罗斯通亚公寓酒店', districts: ['hollywood'], x: 126.4, y: 37.0 },
  { id: 33, name: '日落大道', districts: ['hollywood'], x: 143.0, y: 42.2 },
  { id: 34, name: '黑钻石赌场', districts: ['hollywood'], x: 155.1, y: 5.3 },
  { id: 35, name: '格伦代尔大道和河滨大道', districts: ['hollywood'], x: 175.9, y: 17.9 },
  { id: 36, name: '格伦代尔警局', districts: ['hollywood'], x: 153.7, y: 25.3 },
  { id: 37, name: '安吉利斯主教堂', districts: ['hollywood'], x: 169.9, y: 37.0 },
  // 好莱坞 ∩ 中央城区 —— 边 (100,56)-(176,56)
  { id: 38, name: '胡佛街和庙街', districts: ['hollywood', 'central'], x: 138.0, y: 56.0 },
  { id: 39, name: '佛蒙特大道和比科大道', districts: ['central'], x: 129.3, y: 95.0 },
  { id: 40, name: '阿尔瓦拉多街', districts: ['central'], x: 144.7, y: 82.2 },
  { id: 41, name: '洛杉矶图书馆', districts: ['central'], x: 162.2, y: 72.5 },
  { id: 42, name: '奥林匹克体育场', districts: ['central'], x: 142.4, y: 110.2 },
  { id: 43, name: '希尔街和华盛顿大道', districts: ['central'], x: 123.9, y: 72.5 },
  { id: 44, name: '瑞格利球场', districts: ['central'], x: 161.4, y: 117.0 },
  // 好莱坞 ∩ 中央城区 —— 边 (100,56)-(176,56)
  { id: 45, name: '洛杉矶时报', districts: ['hollywood', 'central'], x: 158.0, y: 56.0 },
  { id: 46, name: '市政厅', districts: ['central'], x: 188.2, y: 72.2 },
  { id: 47, name: '联合车站', districts: ['central'], x: 208.2, y: 73.1 },
  { id: 48, name: '布雷德伯里大厦', districts: ['central'], x: 175.3, y: 87.7 },
  { id: 49, name: '圣佩德罗大道和第九街', districts: ['central'], x: 182.7, y: 106.8 },
  { id: 50, name: '阿拉米达街和弗农街', districts: ['central'], x: 191.7, y: 124.8 },
  { id: 51, name: '洛杉矶警察局总部', districts: ['central'], x: 195.0, y: 91.0 },
  // 好莱坞 ∩ 中央城区 —— 边东端 (176,56)
  { id: 52, name: '唐人街', districts: ['hollywood', 'central'], x: 176.0, y: 56.0 },
  // 圣盖博谷 ∩ 中央城区 —— 边 (226,76)-(222,132)
  { id: 53, name: '圣所路和山谷大道', districts: ['gabriel', 'central'], x: 226.0, y: 76.0 },
  // 仅中央
  { id: 54, name: '洛杉矶总医院', districts: ['central'], x: 204.0, y: 109.0 },
  { id: 55, name: '圣维比亚纳大教堂', districts: ['central'], x: 215.1, y: 86.9 },
  // 圣盖博谷 ∩ 中央城区 —— 边 (226,76)-(222,132)
  { id: 56, name: '加维大道和布鲁克林大道', districts: ['gabriel', 'central'], x: 224.3, y: 100.0 },
  { id: 57, name: '电报路和第九街', districts: ['gabriel', 'central'], x: 223.0, y: 118.0 },
  // 好莱坞 ∩ 圣盖博谷 —— 边 (218,0)-(218,48)
  { id: 58, name: '西方学院', districts: ['hollywood', 'gabriel'], x: 218.0, y: 40.0 },
  { id: 59, name: '梧桐公园', districts: ['hollywood', 'gabriel'], x: 218.0, y: 20.0 },
  { id: 60, name: '科罗拉多大道', districts: ['gabriel'], x: 243.5, y: 17.5 },
  { id: 61, name: '西南博物馆', districts: ['gabriel'], x: 245.8, y: 37.8 },
  { id: 62, name: '阿罗约维斯塔酒店', districts: ['gabriel'], x: 262.0, y: 25.2 },
  { id: 63, name: '帕萨迪纳警局', districts: ['gabriel'], x: 264.5, y: 45.1 },
  { id: 64, name: '阿斯科特赛车场', districts: ['gabriel'], x: 259.8, y: 64.6 },
  { id: 65, name: '大西洋大道和圣所路', districts: ['gabriel'], x: 283.8, y: 50.4 },
  { id: 66, name: '大西洋大道和科罗拉多大道', districts: ['gabriel'], x: 282.7, y: 30.4 },
  { id: 67, name: '威尔逊山天文台', districts: ['gabriel'], x: 245.8, y: -5 },
  { id: 68, name: '圣所路', districts: ['gabriel'], x: 302.7, y: 57.0 },
  { id: 69, name: '盖伊狮子农场', districts: ['gabriel'], x: 299.1, y: 76.7 },
  { id: 70, name: '米德威克乡村俱乐部', districts: ['gabriel'], x: 279.1, y: 69.9 },
  { id: 71, name: '蒙特贝洛高尔夫俱乐部', districts: ['gabriel'], x: 245.8, y: 82.2 },
  { id: 72, name: '蒙特贝洛警局', districts: ['gabriel'], x: 277.4, y: 108.4 },
  { id: 73, name: '加维大道和惠蒂尔大道', districts: ['gabriel'], x: 257.4, y: 107.8 },
  { id: 74, name: '惠蒂尔大道', districts: ['gabriel'], x: 297.3, y: 104.0 },
  { id: 75, name: '州立公路', districts: ['gabriel'], x: 288.2, y: 125.3 },
  { id: 76, name: '里维埃拉俱乐部', districts: ['south'], x: 54.1, y: 156.4 },
  { id: 77, name: '托伦斯油田', districts: ['south'], x: 75.8, y: 153.9 },
  { id: 78, name: '帕洛斯弗迪斯丘陵', districts: ['south'], x: 66.6, y: 172.0 },
  { id: 79, name: '帕洛斯弗迪斯海滩', districts: ['south'], x: 82.4, y: 187.0 },
  { id: 80, name: '纳尔博纳大街和阿纳海姆街', districts: ['south'], x: 89.7, y: 168.4 },
  { id: 81, name: '西大街和阿纳海姆街', districts: ['south'], x: 106.8, y: 157.8 },
  // 南湾 ∩ 中央城区 —— 边 (100,116)-(128,130)-(176,138)-(222,132)
  { id: 82, name: '佛蒙特大道和曼彻斯特大道', districts: ['south', 'central'], x: 125.0, y: 128.5 },
  { id: 83, name: '佛蒙特大道和卡森大道', districts: ['south'], x: 123.9, y: 147.5 },
  { id: 84, name: '圣佩德罗警局', districts: ['south'], x: 114.3, y: 176.4 },
  { id: 85, name: '弗明角', districts: ['south'], x: 111.7, y: 196.3 },
  { id: 86, name: '圣佩德罗大道', districts: ['south'], x: 132.8, y: 184.0 },
  { id: 87, name: '圣佩德罗大道和阿纳海姆街', districts: ['south'], x: 150.6, y: 174.7 },
  { id: 88, name: '特米诺岛联邦监狱', districts: ['south'], x: 164.9, y: 188.7 },
  { id: 89, name: '洛杉矶海港灯塔', districts: ['south'], x: 147.2, y: 198.0 },
  // 仅南湾
  { id: 90, name: '百老汇大道和雷东多大道', districts: ['south'], x: 141.6, y: 156.8 },
  // 南湾 ∩ 中央城区
  { id: 91, name: '圣佩德罗大道和曼彻斯特大道', districts: ['south', 'central'], x: 161.0, y: 136.7 },
  // 仅南湾
  { id: 92, name: '雷东多大道', districts: ['south'], x: 190.4, y: 169.9 },
  { id: 93, name: '联合炼油厂', districts: ['south'], x: 161.0, y: 151.7 },
  { id: 94, name: '长滩市政厅', districts: ['south'], x: 89.7, y: 147.5 },
  { id: 95, name: '长滩警局', districts: ['south'], x: 181.0, y: 152.3 },
  // 南湾 ∩ 中央城区
  { id: 96, name: '托普西夜总会', districts: ['south', 'central'], x: 191.7, y: 136.7 },
  // 仅南湾
  { id: 97, name: '大西洋大道', districts: ['south'], x: 204.0, y: 152.3 },
  // 三区交界角点 (222,132)
  { id: 98, name: '大西洋大道和费尔斯通大道', districts: ['gabriel', 'central', 'south'], x: 222.0, y: 132.0 },
  { id: 99, name: '马蹄铁码头', districts: ['south'], x: 170.4, y: 169.4 },
  { id: 100, name: '阿纳海姆街', districts: ['south'], x: 222.0, y: 152.3 },
].map((s) => ({
  ...s,
  district: s.districts[0],
  siteType: POLICE_SET.has(s.id) ? 'police' : GANG_SET.has(s.id) ? 'gang' : null,
}));

/** 线路连通关系（相邻站点）——仅逻辑可达，不绘制 */
const EDGES = [
  [1, 2], [1, 8], [2, 3], [2, 5], [3, 4], [3, 9], [4, 7], [5, 6], [6, 7],
  [7, 13], [8, 9], [8, 26], [9, 10], [9, 11], [10, 12], [10, 17], [11, 13],
  [11, 14], [12, 18], [13, 15], [13, 20], [14, 20], [15, 16], [16, 23],
  [17, 18], [17, 26], [17, 31], [18, 19], [18, 20], [19, 22], [19, 39],
  [20, 21], [21, 22], [21, 23], [22, 42], [22, 82], [23, 76],
  [24, 25], [24, 28], [25, 26], [25, 27], [26, 27], [27, 28], [27, 31],
  [28, 29], [28, 32], [29, 30], [30, 33], [31, 32], [31, 38], [32, 33],
  [32, 38], [33, 36], [34, 35], [34, 36], [35, 37], [35, 58], [36, 37],
  [36, 38], [37, 45], [38, 40],
  [39, 40], [39, 42], [40, 41], [40, 43], [41, 45], [41, 48], [42, 43],
  [42, 82], [43, 44], [43, 49], [44, 49], [44, 91], [45, 46], [45, 48],
  [46, 47], [46, 52], [47, 48], [47, 55], [48, 49], [48, 51], [49, 50],
  [50, 57], [50, 91], [51, 52], [51, 55], [52, 53], [52, 59],
  [53, 54], [53, 63], [54, 55], [54, 56], [55, 56], [56, 57], [56, 73],
  [57, 73], [57, 98], [58, 59], [58, 60], [59, 61], [60, 61], [60, 62],
  [61, 62], [61, 63], [62, 66], [63, 64], [64, 65], [64, 70], [65, 66],
  [65, 68], [66, 67], [68, 69], [69, 70], [70, 71], [71, 72], [72, 73],
  [72, 74], [73, 98], [74, 75], [75, 98],
  [76, 77], [76, 83], [77, 78], [78, 79], [79, 80], [80, 81], [81, 83],
  [82, 83], [82, 90], [83, 84], [83, 90], [84, 85], [84, 86], [85, 86],
  [86, 87], [87, 88], [87, 93], [88, 89], [88, 99], [90, 91], [90, 93],
  [91, 92], [91, 96], [92, 93], [92, 95], [93, 94], [94, 95], [95, 97],
  [96, 97], [96, 98], [97, 98], [97, 100], [99, 100],
];

const connectionMap = new Map();

function ensureConn(id) {
  if (!connectionMap.has(id)) connectionMap.set(id, new Set());
  return connectionMap.get(id);
}

EDGES.forEach(([a, b]) => {
  ensureConn(a).add(b);
  ensureConn(b).add(a);
});

STATIONS.forEach((s) => ensureConn(s.id));

export function getStation(id) {
  return STATIONS.find((s) => s.id === id) ?? null;
}

export function getConnections(id) {
  return [...(connectionMap.get(id) ?? [])];
}

/** 版图道路相邻（旧规则，保留供调试） */
export function areAdjacent(fromId, toId) {
  if (fromId === toId) return false;
  return connectionMap.get(fromId)?.has(toId) ?? false;
}

/**
 * 同区可前往：
 * - 当前点所属任一区域，与目标点所属区域有交集即可前往
 * - 交界点可前往其所属全部区域中的任意点
 */
export function canTravelTo(fromId, toId) {
  if (fromId == null || toId == null) return false;
  if (fromId === toId) return false;
  const fromDistricts = getStationDistrictIds(fromId);
  const toDistricts = getStationDistrictIds(toId);
  if (!fromDistricts.length || !toDistricts.length) return false;
  return fromDistricts.some((d) => toDistricts.includes(d));
}

/** 从某点可前往的全部站点 id */
export function getReachableStationIds(fromId) {
  return STATIONS.filter((s) => canTravelTo(fromId, s.id)).map((s) => s.id);
}

export function getStationLabel(id) {
  const s = getStation(id);
  return s ? `#${s.id} ${s.name}` : `#${id}`;
}

/** 站点所属区域 id 列表 */
export function getStationDistrictIds(stationOrId) {
  const s = typeof stationOrId === 'number' ? getStation(stationOrId) : stationOrId;
  if (!s) return [];
  return s.districts ?? (s.district ? [s.district] : []);
}

/** 站点是否属于某区（含交界双属/三属） */
export function stationInDistrict(stationOrId, districtId) {
  return getStationDistrictIds(stationOrId).includes(districtId);
}

/** 站点所属区域中文名（交界点用「 / 」拼接） */
export function getStationDistrictNames(stationOrId) {
  const ids = getStationDistrictIds(stationOrId);
  const names = ids.map((id) => DISTRICTS.find((d) => d.id === id)?.name).filter(Boolean);
  return names.length ? names.join(' / ') : '未知区域';
}

/** 是否为交界点（归属 ≥ 2 区） */
export function isBorderStation(stationOrId) {
  return getStationDistrictIds(stationOrId).length >= 2;
}

export function getStationSiteType(stationOrId) {
  const s = typeof stationOrId === 'number' ? getStation(stationOrId) : stationOrId;
  return s?.siteType ?? null;
}

export function isPoliceStation(stationOrId) {
  return getStationSiteType(stationOrId) === 'police';
}

export function isGangStation(stationOrId) {
  return getStationSiteType(stationOrId) === 'gang';
}

/** 可选出生点：全部警局 */
export function getPoliceStations() {
  return POLICE_STATION_IDS.map((id) => getStation(id)).filter(Boolean);
}

/** 将站点原始坐标转换为扩展画布坐标（加偏移） */
export function stationCanvasX(s) {
  return ((typeof s === 'number' ? getStation(s) : s)?.x ?? 0) + CORE_OFFSET_X;
}
export function stationCanvasY(s) {
  return ((typeof s === 'number' ? getStation(s) : s)?.y ?? 0) + CORE_OFFSET_Y;
}

/** 将五区 points 字符串中的坐标加上偏移，返回新字符串 */
export function offsetDistrictPoints(points) {
  return points
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return `${x + CORE_OFFSET_X},${y + CORE_OFFSET_Y}`;
    })
    .join(' ');
}
