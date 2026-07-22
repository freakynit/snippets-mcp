import { pipeline } from '@xenova/transformers';

/** Lazily loads the embedding model only for operations that need it. */
export class TransformerEmbedder {
  #modelName;
  #pipelinePromise;

  constructor(modelName) {
    this.#modelName = modelName;
  }

  async embed(text) {
    if (!this.#pipelinePromise) {
      this.#pipelinePromise = pipeline('feature-extraction', this.#modelName)
        .catch((error) => {
          this.#pipelinePromise = undefined;
          throw error;
        });
    }
    const extractor = await this.#pipelinePromise;
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }
}
