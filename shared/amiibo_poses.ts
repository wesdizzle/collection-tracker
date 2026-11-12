/**
 * AMIIBO MULTI-POSE EXPANSION REGISTRY
 *
 * Pure isomorphic registry of amiibo figures that physically shipped with
 * interchangeable poses sharing a single NFC base.
 */

export interface MultiPoseAmiiboPose {
  poseKey: string;
  nameSuffix: string;
  slugSuffix: string;
}

export const MULTI_POSE_AMIIBO_EXPANSIONS: Record<
  string,
  MultiPoseAmiiboPose[]
> = {
  // Mr. Game & Watch (Super Smash Bros. Series) - 4 interchangeable poses
  '07800000002d0002': [
    { poseKey: 'default', nameSuffix: ' (Default)', slugSuffix: '' },
    {
      poseKey: 'parachute',
      nameSuffix: ' (Parachute)',
      slugSuffix: '-parachute',
    },
    { poseKey: 'bell', nameSuffix: ' (Bell)', slugSuffix: '-bell' },
    { poseKey: 'judge', nameSuffix: ' (Judge)', slugSuffix: '-judge' },
  ],
};
