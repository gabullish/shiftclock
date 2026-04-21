// Sprite sheet dimensions and frame coordinates
// All measurements in pixels from the actual generated files

export const CHAR_BASE = {
  url: "/sprites/characters/character_base.png",
  sheetW: 2912, sheetH: 1440,
  cols: 12, rows: 6,
  cellW: 2912 / 12,  // 242.67
  cellH: 1440 / 6,   // 240
  renderScale: 0.22,
  // Row → direction
  rowDown: 0,
  rowUp: 1,
  rowLeft: 2,
  rowRight: 3,
  rowWalkDown: 4,
  rowWalkRight: 5,
  // 4 skin variants, each 3 frames wide → col = (variant * 3) + frame
  variants: 4,
  framesPerVariant: 3,
};

export const CHAR_STATES = {
  url: "/sprites/characters/character_states.png",
  sheetW: 2912, sheetH: 1440,
  cols: 4, rows: 2,
  cellW: 2912 / 4,   // 728
  cellH: 1440 / 2,   // 720
  renderScale: 0.11,
  // [col, row] for each room state
  office:    [0, 0] as [number, number],   // sitting at desk
  office2:   [1, 0] as [number, number],   // typing (alt frame)
  bedroom:   [2, 0] as [number, number],   // sleeping
  bedroom2:  [3, 0] as [number, number],   // sleeping alt
  breakroom: [0, 1] as [number, number],   // on couch
  breakroom2:[1, 1] as [number, number],   // couch + coffee
  beach:     [2, 1] as [number, number],   // beach lounger
  clinic:    [3, 1] as [number, number],   // clinic bed
};

export const FLOOR_TILES = {
  url: "/sprites/tiles/floor_tiles.png",
  sheetW: 4640, sheetH: 928,
  cellW: 928, cellH: 928,
  tileRenderSize: 96,   // how big each tile renders in world px
  // Column per room
  office: 0,
  bedroom: 2,
  breakroom: 1,
  clinic: 3,
  beach: 4,
};

export const FURNITURE = {
  office: {
    url: "/sprites/furniture/office/office_furniture.png",
    sheetW: 3264, sheetH: 1312,
    cols: 5, rows: 2,
    cellW: 3264 / 5, cellH: 1312 / 2,
    scale: 0.1,
    items: {
      desk:      [0, 0] as [number, number],
      chair:     [1, 0] as [number, number],
      bookshelf: [2, 0] as [number, number],
      plant:     [3, 0] as [number, number],
      whiteboard:[4, 0] as [number, number],
      monitor:   [0, 1] as [number, number],
      lamp:      [1, 1] as [number, number],
      cabinet:   [2, 1] as [number, number],
      bin:       [3, 1] as [number, number],
      coffee:    [4, 1] as [number, number],
    },
  },
  bedroom: {
    url: "/sprites/furniture/bedroom/bedroom_furniture.png",
    sheetW: 4640, sheetH: 928,
    cols: 5, rows: 1,
    cellW: 928, cellH: 928,
    scale: 0.1,
    items: {
      singleBed: [0, 0] as [number, number],
      doubleBed: [1, 0] as [number, number],
      nightstand:[2, 0] as [number, number],
      wardrobe:  [3, 0] as [number, number],
      rug:       [4, 0] as [number, number],
    },
  },
  breakroom: {
    url: "/sprites/furniture/breakroom/breakroom_furniture.png",
    sheetW: 4640, sheetH: 928,
    cols: 5, rows: 1,
    cellW: 928, cellH: 928,
    scale: 0.1,
    items: {
      sofa:    [0, 0] as [number, number],
      table:   [1, 0] as [number, number],
      coffee:  [2, 0] as [number, number],
      fridge:  [3, 0] as [number, number],
      beanbag: [4, 0] as [number, number],
    },
  },
  clinic: {
    url: "/sprites/furniture/clinic/clinic_furniture.png",
    sheetW: 4128, sheetH: 1024,
    cols: 4, rows: 1,
    cellW: 1032, cellH: 1024,
    scale: 0.1,
    items: {
      bed:     [0, 0] as [number, number],
      iv:      [1, 0] as [number, number],
      desk:    [2, 0] as [number, number],
      cabinet: [3, 0] as [number, number],
    },
  },
  beach: {
    url: "/sprites/furniture/beach/beach_furniture.png",
    sheetW: 4640, sheetH: 928,
    cols: 5, rows: 1,
    cellW: 928, cellH: 928,
    scale: 0.12,
    items: {
      lounger:  [0, 0] as [number, number],
      umbrella: [1, 0] as [number, number],
      palm:     [2, 0] as [number, number],
      cooler:   [3, 0] as [number, number],
      coconut:  [4, 0] as [number, number],
    },
  },
};
