declare module 'sdf-polygon-2d' {
  export type SDF = (x: number, y: number) => number;

  export default function createSDF(polygons: number[][][]): SDF;
}
