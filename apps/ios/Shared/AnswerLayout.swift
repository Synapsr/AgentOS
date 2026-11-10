import SwiftUI

/// The answers to a request: two sit side by side, the same size, while
/// each has room for its words; otherwise — and when there are more — one
/// above the other. An answer is never cut short.
struct AnswerLayout: Layout {
    var gap: CGFloat = Tokens.Space.s12
    /// Always one above the other, whatever the room.
    var stacks = false
    /// Side by side, the last one leads: an approval is given stacked as
    /// Go ahead, Stop — and a row reads Stop, Go ahead.
    var leadsWithLast = false

    private func isRow(_ subviews: Subviews, width: CGFloat) -> Bool {
        let widest = subviews.map { $0.sizeThatFits(.unspecified).width }.max() ?? 0
        return !stacks && subviews.count == 2 && widest * 2 + gap <= width
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? subviews.map { $0.sizeThatFits(.unspecified).width }.reduce(0, +)
        let isRow = isRow(subviews, width: width)
        let column = isRow ? (width - gap) / 2 : width
        let heights = subviews.map { $0.sizeThatFits(ProposedViewSize(width: column, height: nil)).height }
        let stacked = heights.reduce(0, +) + gap * CGFloat(max(0, subviews.count - 1))
        return CGSize(width: width, height: isRow ? heights.max() ?? 0 : stacked)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let isRow = isRow(subviews, width: bounds.width)
        let width = isRow ? (bounds.width - gap) / 2 : bounds.width
        var corner = bounds.origin
        for subview in isRow && leadsWithLast ? Array(subviews.reversed()) : Array(subviews) {
            let size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
            subview.place(at: corner, proposal: ProposedViewSize(width: width, height: size.height))
            if isRow { corner.x += width + gap } else { corner.y += size.height + gap }
        }
    }
}
