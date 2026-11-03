# Quiz widget

`dist/quiz.js` draws a closed-book answer sheet in a chat widget from one JSON spec, the way
`dist/techviz.js` draws figures. Put the spec in a `data-quiz` script tag and load the bundle
from the same jsDelivr tag as techviz:

```html
<script type="application/json" data-quiz>{"v":1,"id":"phys42-rq-2026-11-10","title":"PHYS 42 mock reading quiz", ...}</script>
<script src="https://cdn.jsdelivr.net/gh/dante32683/techviz@vX.Y.Z/dist/quiz.js"></script>
```

The sheet shows a Start button first, so the timer starts when the reader starts, not when
the widget loads. Each question has a "guess" box. Submit sends every answer to the chat as
one message through the host's `sendPrompt` (or shows the text to copy when there is none):

```
PHYS 42 mock reading quiz [phys42-rq-2026-11-10]: my answers (4 min 12 s)
1: c
2: b (guess)
3: 1.0e-4 T
```

Answers and the start time are kept in `localStorage` under the quiz `id`, so a redrawn widget
keeps them and a submitted quiz stays locked. KaTeX loads from jsDelivr; a question with a
figure also loads `techviz.js` from the same folder as `quiz.js`.

## Spec

Top level:

- `id`: unique per quiz (course, quiz, date). It keys saved answers and appears in the sent
  message, so the grader can find the key.
- `title`, `subtitle`: shown in the bar beside the timer.
- `minutes`: optional time limit; the timer shows `m:ss / limit` and turns red past it.
- `intro`: optional line above the Start button.
- `closed`: `false` drops "closed book" from the bar.
- `questions`: the list below.

Each question:

- `q`: the question text. Inline markup: `$...$` and `$$...$$` math (KaTeX), `` `code` ``,
  `**bold**`. JSON strings need `\\` for one TeX backslash.
- `code`: a code block shown under the text, exactly as written (real newlines and
  indentation, `\n` in JSON).
- `fig`: a techviz spec drawn under the text.
- `after`: optional text after the code or figure.
- `choices`: 2 to 8 answer strings (same inline markup); the sheet adds the letters. Without
  `choices` the question gets a text box; `lines: 3` makes it a taller box for longer answers.
- `placeholder`: the text box's hint.

The answer key never goes in the spec, since the widget's code is visible.
