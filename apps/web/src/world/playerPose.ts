/**
 * Where the viewer is on the floor plan (walk mode position, or the overview camera target).
 * Mutated every frame by the 3D world and read by the minimap animation loop, outside React.
 */
export const playerPose = { x: 0, z: 0, yaw: 0 };
