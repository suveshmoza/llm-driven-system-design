declare module 'polyline' {
  export function decode(str: string): number[][];
  export function encode(coordinates: number[][]): string;
}
