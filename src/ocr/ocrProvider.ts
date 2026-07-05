export interface OcrInput {
  imageUrl: string;
}

export interface OcrResult {
  text: string;
}

export interface OcrProvider {
  extractText(input: OcrInput): Promise<OcrResult>;
}
