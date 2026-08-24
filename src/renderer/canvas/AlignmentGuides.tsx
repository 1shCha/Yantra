import { ViewportPortal, useViewport } from '@xyflow/react';

import type { AlignmentGuide } from './alignment-guides';

const GUIDE_WIDTH_SCREEN_PIXELS = 1.5;
const GUIDE_ENDPOINT_DIAMETER_SCREEN_PIXELS = 5;

interface AlignmentGuidesProps {
  horizontalGuide: AlignmentGuide | null;
  verticalGuide: AlignmentGuide | null;
}

export function AlignmentGuides({
  horizontalGuide,
  verticalGuide,
}: AlignmentGuidesProps) {
  const { zoom } = useViewport();
  const guideWidth = GUIDE_WIDTH_SCREEN_PIXELS / zoom;
  const endpointDiameter = GUIDE_ENDPOINT_DIAMETER_SCREEN_PIXELS / zoom;

  return (
    <ViewportPortal>
      {verticalGuide ? (
        <div
          aria-hidden="true"
          className="alignment-guide"
          data-orientation="vertical"
          style={{
            height: verticalGuide.end - verticalGuide.start,
            left: verticalGuide.coordinate - guideWidth / 2,
            top: verticalGuide.start,
            width: guideWidth,
          }}
        >
          <span
            className="alignment-guide__endpoint"
            data-end="start"
            style={{ width: endpointDiameter, height: endpointDiameter }}
          />
          <span
            className="alignment-guide__endpoint"
            data-end="end"
            style={{ width: endpointDiameter, height: endpointDiameter }}
          />
        </div>
      ) : null}
      {horizontalGuide ? (
        <div
          aria-hidden="true"
          className="alignment-guide"
          data-orientation="horizontal"
          style={{
            height: guideWidth,
            left: horizontalGuide.start,
            top: horizontalGuide.coordinate - guideWidth / 2,
            width: horizontalGuide.end - horizontalGuide.start,
          }}
        >
          <span
            className="alignment-guide__endpoint"
            data-end="start"
            style={{ width: endpointDiameter, height: endpointDiameter }}
          />
          <span
            className="alignment-guide__endpoint"
            data-end="end"
            style={{ width: endpointDiameter, height: endpointDiameter }}
          />
        </div>
      ) : null}
    </ViewportPortal>
  );
}
