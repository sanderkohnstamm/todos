import SwiftUI
import UIKit

/// UITextView subclass that controls when it can become first responder,
/// preventing the keyboard from opening on first tap.
class TallyTextView: UITextView {
    var allowEditing = false

    override var canBecomeFirstResponder: Bool {
        allowEditing
    }
}

/// A UITextView wrapper with two-tap interaction:
/// - First tap: highlight the line (no keyboard)
/// - Second tap on same line: open keyboard for editing
struct MarkdownTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var cursorLine: Int
    @Binding var isEditing: Bool
    let theme: ThemePalette
    let undoManager: UndoManager?

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> TallyTextView {
        // Use TextKit 1 explicitly for reliable layout manager access
        let textStorage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        textStorage.addLayoutManager(layoutManager)
        let textContainer = NSTextContainer(size: .zero)
        textContainer.widthTracksTextView = true
        layoutManager.addTextContainer(textContainer)

        let textView = TallyTextView(frame: .zero, textContainer: textContainer)
        textView.delegate = context.coordinator
        textView.isEditable = false
        textView.isSelectable = false
        textView.allowEditing = false
        textView.isScrollEnabled = true
        textView.font = .monospacedSystemFont(ofSize: 15, weight: .regular)
        textView.autocapitalizationType = .none
        textView.autocorrectionType = .no
        textView.smartDashesType = .no
        textView.smartQuotesType = .no
        textView.smartInsertDeleteType = .no
        textView.keyboardDismissMode = .interactive
        textView.textContainerInset = UIEdgeInsets(top: 12, left: 8, bottom: 12, right: 8)
        textView.alwaysBounceVertical = true

        // Line highlight view (subview of UITextView so it scrolls with content)
        let highlight = UIView()
        highlight.isUserInteractionEnabled = false
        highlight.layer.cornerRadius = 3
        highlight.isHidden = true
        textView.insertSubview(highlight, at: 0)
        context.coordinator.highlightView = highlight

        // Tap gesture for line selection (only fires when not editing)
        let tap = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleTap(_:))
        )
        tap.delegate = context.coordinator
        textView.addGestureRecognizer(tap)

        if let um = undoManager {
            textView.undoManager?.removeAllActions()
            context.coordinator.externalUndoManager = um
        }

        applyTheme(textView)
        return textView
    }

    func updateUIView(_ textView: TallyTextView, context: Context) {
        if textView.text != text {
            let selectedRange = textView.selectedRange
            textView.text = text
            if selectedRange.location <= text.count {
                textView.selectedRange = selectedRange
            }
        }

        if isEditing {
            textView.allowEditing = true
            textView.isEditable = true
            textView.isSelectable = true
        } else {
            textView.allowEditing = false
            textView.isEditable = false
            textView.isSelectable = false
        }

        applyTheme(textView)

        // Defer highlight update to after layout
        DispatchQueue.main.async {
            context.coordinator.updateHighlight(in: textView)
        }
    }

    private func applyTheme(_ textView: TallyTextView) {
        textView.backgroundColor = UIColor(theme.bg)
        textView.textColor = UIColor(theme.text)
        textView.tintColor = UIColor(theme.blue)
    }

    // MARK: - Coordinator

    class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate {
        var parent: MarkdownTextView
        var externalUndoManager: UndoManager?
        var highlightView: UIView?

        init(_ parent: MarkdownTextView) {
            self.parent = parent
        }

        // MARK: Gesture Delegate

        /// Only allow the custom tap gesture when not editing,
        /// so UITextView's built-in gestures handle taps normally during editing.
        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            !parent.isEditing
        }

        // MARK: Tap Handling

        @objc func handleTap(_ gesture: UITapGestureRecognizer) {
            guard let textView = gesture.view as? TallyTextView else { return }

            let point = gesture.location(in: textView)
            guard let tappedLine = lineIndex(at: point, in: textView) else { return }

            if parent.cursorLine == tappedLine {
                // Second tap on same line → enter edit mode
                parent.isEditing = true
                textView.allowEditing = true
                textView.isEditable = true
                textView.isSelectable = true
                textView.becomeFirstResponder()

                // Position cursor at the tap point
                if let position = textView.closestPosition(to: point) {
                    textView.selectedTextRange = textView.textRange(from: position, to: position)
                }
            } else {
                // First tap → select line
                parent.cursorLine = tappedLine
                updateHighlight(in: textView)
            }
        }

        // MARK: UITextViewDelegate

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            // Only track cursor line while editing
            guard parent.isEditing else { return }
            let cursorPos = textView.selectedRange.location
            let text = textView.text ?? ""
            let prefix = String(text.prefix(cursorPos))
            let line = prefix.components(separatedBy: "\n").count - 1
            parent.cursorLine = line
            updateHighlight(in: textView)
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            guard let tv = textView as? TallyTextView else { return }
            parent.isEditing = false
            tv.allowEditing = false
            tv.isEditable = false
            tv.isSelectable = false
            updateHighlight(in: tv)
        }

        // MARK: Highlight

        func lineIndex(at point: CGPoint, in textView: UITextView) -> Int? {
            let layoutManager = textView.layoutManager
            let textContainer = textView.textContainer

            var adjustedPoint = point
            adjustedPoint.x -= textView.textContainerInset.left
            adjustedPoint.y -= textView.textContainerInset.top

            let charIndex = layoutManager.characterIndex(
                for: adjustedPoint, in: textContainer,
                fractionOfDistanceBetweenInsertionPoints: nil
            )

            let text = textView.text ?? ""
            guard charIndex <= text.count else { return nil }
            let prefix = String(text.prefix(charIndex))
            return prefix.components(separatedBy: "\n").count - 1
        }

        func updateHighlight(in textView: UITextView) {
            guard let highlight = highlightView else { return }

            let text = textView.text ?? ""
            let lines = text.components(separatedBy: "\n")
            let line = parent.cursorLine

            guard line >= 0, line < lines.count else {
                highlight.isHidden = true
                return
            }

            // Calculate the character range of the selected line
            var charOffset = 0
            for i in 0..<line {
                charOffset += lines[i].count + 1
            }
            let lineLength = max(lines[line].count, 1)
            let nsRange = NSRange(location: charOffset, length: lineLength)

            let layoutManager = textView.layoutManager
            let textContainer = textView.textContainer
            let glyphRange = layoutManager.glyphRange(
                forCharacterRange: nsRange, actualCharacterRange: nil
            )
            let lineRect = layoutManager.boundingRect(
                forGlyphRange: glyphRange, in: textContainer
            )

            // Adjust for text container inset, stretch full width
            var rect = lineRect
            rect.origin.x = textView.textContainerInset.left
            rect.origin.y += textView.textContainerInset.top
            rect.size.width = textView.bounds.width
                - textView.textContainerInset.left
                - textView.textContainerInset.right

            // Small vertical padding
            rect.origin.y -= 2
            rect.size.height += 4

            highlight.frame = rect
            highlight.backgroundColor = UIColor(parent.theme.overlay)
            highlight.isHidden = false
        }
    }
}
