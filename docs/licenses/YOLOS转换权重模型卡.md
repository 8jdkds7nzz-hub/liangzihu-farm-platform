---
base_model: hustvl/yolos-tiny
library_name: transformers.js
---

https://huggingface.co/hustvl/yolos-tiny with ONNX weights to be compatible with Transformers.js.

## Usage (Transformers.js)

If you haven't already, you can install the [Transformers.js](https://huggingface.co/docs/transformers.js) JavaScript library from [NPM](https://www.npmjs.com/package/@huggingface/transformers) using:
```bash
npm i @huggingface/transformers
```

**Example:** Perform object detection with `Xenova/yolos-tiny`.

```js
import { pipeline } from "@huggingface/transformers";

const detector = await pipeline("object-detection", "Xenova/yolos-tiny");

const image = "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/cats.jpg";
const output = await detector(image, { threshold: 0.9 });
console.log(output);
```

<details>

<summary>Example output</summary>

```
[
  {
    score: 0.9921281933784485,
    label: "remote",
    box: { xmin: 32, ymin: 78, xmax: 185, ymax: 117 },
  },
  {
    score: 0.9884883165359497,
    label: "remote",
    box: { xmin: 324, ymin: 82, xmax: 376, ymax: 191 },
  },
  {
    score: 0.9197800159454346,
    label: "cat",
    box: { xmin: 5, ymin: 56, xmax: 321, ymax: 469 },
  },
  {
    score: 0.9300552606582642,
    label: "cat",
    box: { xmin: 332, ymin: 25, xmax: 638, ymax: 369 },
  },
]
```
  
</details>

---

Note: Having a separate repo for ONNX weights is intended to be a temporary solution until WebML gains more traction. If you would like to make your models web-ready, we recommend converting to ONNX using [🤗 Optimum](https://huggingface.co/docs/optimum/index) and structuring your repo like this one (with ONNX weights located in a subfolder named `onnx`).