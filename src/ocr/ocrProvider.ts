export interface OcrInput {
  imageUrl: string;
  layout?: "block" | "sparse";
}

export interface OcrResult {
  text: string;
}

export interface OcrProvider {
  extractText(input: OcrInput): Promise<OcrResult>;
}
