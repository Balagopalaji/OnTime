declare module 'selfsigned' {
  export interface SelfSignedAttributes {
    name: string
    value: string
  }

  export interface SelfSignedOptions {
    days?: number
    keySize?: number
    extensions?: any[]
  }

  export interface SelfSignedPems {
    private: string
    public: string
    cert: string
  }

  export function generate(attributes?: SelfSignedAttributes[], options?: SelfSignedOptions): SelfSignedPems
}
