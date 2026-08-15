/// <reference types="expo/types" />

declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?: string
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?: string
  }
}
