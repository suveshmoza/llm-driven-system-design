"""
Quality scoring module for drawing data.

Evaluates drawings based on various heuristics to identify low-quality
or potentially problematic submissions before training.
"""

from typing import Any
import math


class QualityScorer:
    """Analyzes stroke data and computes a quality score (0-100)."""

    # Thresholds for quality checks
    MIN_STROKES = 1
    MAX_STROKES = 20
    MIN_TOTAL_POINTS = 5
    MAX_TOTAL_POINTS = 2000
    MIN_DURATION_MS = 200
    MAX_DURATION_MS = 60000
    MIN_COVERAGE = 0.01
    MAX_COVERAGE = 0.90
    MIN_BOUNDING_BOX_RATIO = 0.1

    def __init__(self, stroke_data: dict[str, Any]):
        """Initialize scorer with stroke data."""
        self.data = stroke_data
        self.strokes = stroke_data.get('strokes', [])
        self.canvas = stroke_data.get('canvas', {'width': 400, 'height': 400})
        self.duration_ms = stroke_data.get('duration_ms', 0)

        self.canvas_width = self.canvas.get('width', 400)
        self.canvas_height = self.canvas.get('height', 400)

        # Compute derived metrics
        self._compute_metrics()

    def _compute_metrics(self):
        """Compute derived metrics from stroke data."""
        self.total_points = 0
        self.min_x = float('inf')
        self.max_x = float('-inf')
        self.min_y = float('inf')
        self.max_y = float('-inf')

        for stroke in self.strokes:
            points = stroke.get('points', [])
            self.total_points += len(points)

            for pt in points:
                x, y = pt.get('x', 0), pt.get('y', 0)
                self.min_x = min(self.min_x, x)
                self.max_x = max(self.max_x, x)
                self.min_y = min(self.min_y, y)
                self.max_y = max(self.max_y, y)

        # Handle empty drawings
        if self.total_points == 0:
            self.min_x = self.max_x = self.min_y = self.max_y = 0

        # Bounding box dimensions
        self.bbox_width = max(0, self.max_x - self.min_x)
        self.bbox_height = max(0, self.max_y - self.min_y)

        # Approximate ink coverage (line length)
        self.total_ink = self._calculate_ink_length()

    def _calculate_ink_length(self) -> float:
        """Calculate total ink length (sum of all line segments)."""
        total = 0.0
        for stroke in self.strokes:
            points = stroke.get('points', [])
            for i in range(1, len(points)):
                dx = points[i]['x'] - points[i-1]['x']
                dy = points[i]['y'] - points[i-1]['y']
                total += math.sqrt(dx*dx + dy*dy)
        return total

    def check_stroke_count(self) -> tuple[float, str]:
        """Check if stroke count is reasonable."""
        count = len(self.strokes)

        if count == 0:
            return 0.0, "No strokes"
        if count < self.MIN_STROKES:
            return 0.3, f"Too few strokes ({count})"
        if count > self.MAX_STROKES:
            return 0.5, f"Too many strokes ({count})"

        # Optimal range: 1-10 strokes
        if count <= 10:
            return 1.0, "Good stroke count"
        else:
            # Gradually decrease score for more strokes
            return max(0.5, 1.0 - (count - 10) * 0.05), f"High stroke count ({count})"

    def check_point_count(self) -> tuple[float, str]:
        """Check if total point count is reasonable."""
        if self.total_points < self.MIN_TOTAL_POINTS:
            return 0.2, f"Too few points ({self.total_points})"
        if self.total_points > self.MAX_TOTAL_POINTS:
            return 0.4, f"Too many points ({self.total_points})"

        return 1.0, "Good point count"

    def check_duration(self) -> tuple[float, str]:
        """Check if drawing duration is reasonable."""
        if self.duration_ms < self.MIN_DURATION_MS:
            return 0.3, f"Too fast ({self.duration_ms}ms)"
        if self.duration_ms > self.MAX_DURATION_MS:
            return 0.7, f"Very slow ({self.duration_ms}ms)"

        # Optimal range: 500ms - 10s
        if 500 <= self.duration_ms <= 10000:
            return 1.0, "Good duration"
        elif self.duration_ms < 500:
            return 0.6, f"Quick drawing ({self.duration_ms}ms)"
        else:
            return 0.8, f"Slow drawing ({self.duration_ms}ms)"

    def check_bounding_box(self) -> tuple[float, str]:
        """Check if drawing fills a reasonable portion of the canvas."""
        if self.total_points == 0:
            return 0.0, "Empty drawing"

        canvas_area = self.canvas_width * self.canvas_height
        bbox_area = self.bbox_width * self.bbox_height

        if canvas_area == 0:
            return 0.5, "Invalid canvas"

        ratio = bbox_area / canvas_area

        if ratio < self.MIN_BOUNDING_BOX_RATIO:
            return 0.4, f"Drawing too small ({ratio:.1%} of canvas)"
        if ratio > 0.9:
            # Drawing spans almost entire canvas - might be intentional
            return 0.9, "Drawing spans most of canvas"

        # Check aspect ratio of bounding box
        if self.bbox_width > 0 and self.bbox_height > 0:
            aspect = self.bbox_width / self.bbox_height
            # Extreme aspect ratios are suspicious
            if aspect < 0.1 or aspect > 10:
                return 0.6, f"Extreme aspect ratio ({aspect:.2f})"

        return 1.0, "Good bounding box"

    def check_ink_coverage(self) -> tuple[float, str]:
        """Check ink coverage relative to canvas size."""
        if self.total_points == 0:
            return 0.0, "No ink"

        canvas_diagonal = math.sqrt(
            self.canvas_width ** 2 + self.canvas_height ** 2
        )

        # Normalize ink length by canvas size
        if canvas_diagonal == 0:
            return 0.5, "Invalid canvas"

        coverage_ratio = self.total_ink / canvas_diagonal

        if coverage_ratio < self.MIN_COVERAGE:
            return 0.3, f"Very little ink ({coverage_ratio:.3f})"
        if coverage_ratio > 5.0:
            # More than 5x the canvas diagonal - heavy scribbling
            return 0.4, f"Excessive ink ({coverage_ratio:.1f}x diagonal)"

        return 1.0, "Good ink coverage"

    def check_stroke_quality(self) -> tuple[float, str]:
        """Check individual stroke quality."""
        if not self.strokes:
            return 0.0, "No strokes"

        issues = []

        for i, stroke in enumerate(self.strokes):
            points = stroke.get('points', [])

            # Check for very short strokes (likely accidental taps)
            if len(points) < 2:
                issues.append(f"Stroke {i+1} has only {len(points)} point(s)")

            # Check for strokes with repeated points (no movement)
            if len(points) >= 2:
                unique_points = set((p['x'], p['y']) for p in points)
                if len(unique_points) == 1:
                    issues.append(f"Stroke {i+1} has no movement")

        if issues:
            if len(issues) > 3:
                return 0.3, f"{len(issues)} stroke issues"
            return 0.6, "; ".join(issues[:2])

        return 1.0, "Good stroke quality"

    def calculate_score(self) -> dict[str, Any]:
        """
        Calculate overall quality score and return detailed results.

        Returns:
            dict with:
                - score: float 0-100
                - passed: bool (score >= 50)
                - checks: list of individual check results
                - recommendation: str
        """
        checks = [
            ('stroke_count', self.check_stroke_count()),
            ('point_count', self.check_point_count()),
            ('duration', self.check_duration()),
            ('bounding_box', self.check_bounding_box()),
            ('ink_coverage', self.check_ink_coverage()),
            ('stroke_quality', self.check_stroke_quality()),
        ]

        # Weighted average
        weights = {
            'stroke_count': 1.0,
            'point_count': 1.0,
            'duration': 0.5,
            'bounding_box': 1.5,
            'ink_coverage': 1.0,
            'stroke_quality': 1.0,
        }

        total_weight = sum(weights.values())
        weighted_sum = sum(
            weights[name] * score for name, (score, _) in checks
        )

        final_score = (weighted_sum / total_weight) * 100

        # Build detailed results
        check_results = [
            {
                'name': name,
                'score': round(score * 100, 1),
                'message': message,
            }
            for name, (score, message) in checks
        ]

        # Determine recommendation
        if final_score >= 70:
            recommendation = "Include in training"
        elif final_score >= 50:
            recommendation = "Review manually"
        else:
            recommendation = "Exclude from training"

        return {
            'score': round(final_score, 1),
            'passed': final_score >= 50,
            'checks': check_results,
            'recommendation': recommendation,
            'metrics': {
                'stroke_count': len(self.strokes),
                'total_points': self.total_points,
                'duration_ms': self.duration_ms,
                'bbox_width': round(self.bbox_width, 1),
                'bbox_height': round(self.bbox_height, 1),
                'total_ink': round(self.total_ink, 1),
            }
        }


def score_drawing(stroke_data: dict[str, Any]) -> dict[str, Any]:
    """Convenience function to score a drawing."""
    scorer = QualityScorer(stroke_data)
    return scorer.calculate_score()


if __name__ == '__main__':
    # Test with sample data
    sample = {
        "shape": "circle",
        "canvas": {"width": 400, "height": 400},
        "strokes": [
            {
                "points": [
                    {"x": 200, "y": 100, "pressure": 0.5, "timestamp": 0},
                    {"x": 280, "y": 150, "pressure": 0.5, "timestamp": 100},
                    {"x": 300, "y": 200, "pressure": 0.5, "timestamp": 200},
                    {"x": 280, "y": 280, "pressure": 0.5, "timestamp": 300},
                    {"x": 200, "y": 300, "pressure": 0.5, "timestamp": 400},
                    {"x": 120, "y": 280, "pressure": 0.5, "timestamp": 500},
                    {"x": 100, "y": 200, "pressure": 0.5, "timestamp": 600},
                    {"x": 120, "y": 150, "pressure": 0.5, "timestamp": 700},
                    {"x": 200, "y": 100, "pressure": 0.5, "timestamp": 800},
                ],
                "color": "#000000",
                "width": 3
            }
        ],
        "duration_ms": 1000
    }

    result = score_drawing(sample)
    print("Quality Analysis:")
    print(f"  Score: {result['score']}/100")
    print(f"  Passed: {result['passed']}")
    print(f"  Recommendation: {result['recommendation']}")
    print("\nChecks:")
    for check in result['checks']:
        print(f"  {check['name']}: {check['score']}/100 - {check['message']}")
    print("\nMetrics:")
    for key, value in result['metrics'].items():
        print(f"  {key}: {value}")
