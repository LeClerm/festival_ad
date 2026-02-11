export const FORMATS = [
  {
    key: '9x16',
    width: 1080,
    height: 1920,
    fps: 60,
    duration: 10.0,
    anchors: {
      headerTopPct: 0.08,
      middlePct: 0.50,
      footerBottomPct: 0.07,
    },
    safe: {
      topPct: 0.10,
      bottomPct: 0.10,
    },
    scaleRefHeight: 1920,
  },
  {
    key: '4x5',
    width: 1080,
    height: 1350,
    fps: 60,
    duration: 10.0,
    anchors: {
      headerTopPct: 0.08,
      middlePct: 0.50,
      footerBottomPct: 0.07,
    },
    safe: {
      topPct: 0.10,
      bottomPct: 0.10,
    },
    scaleRefHeight: 1920,
  },
  {
    key: '1x1',
    width: 1080,
    height: 1080,
    fps: 60,
    duration: 10.0,
    anchors: {
      headerTopPct: 0.08,
      middlePct: 0.50,
      footerBottomPct: 0.07,
    },
    safe: {
      topPct: 0.10,
      bottomPct: 0.10,
    },
    scaleRefHeight: 1920,
  },
];

export function getFormatByKey(key) {
  return FORMATS.find((format) => format.key === key);
}
