// Хэширование паролей — argon2id (ARCHITECTURE §6, PRD §9). Используем @node-rs/argon2
// (prebuilt-бинарники, без node-gyp). Параметры — на уровне рекомендаций OWASP для argon2id:
// 19 МиБ памяти, 2 итерации, parallelism 1. Соль и параметры кодируются в самой строке хэша,
// поэтому verify их читает из хэша, а не из этих опций.
import { hash, verify } from "@node-rs/argon2";

const HASH_OPTIONS = {
  memoryCost: 19_456, // 19 МиБ
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, HASH_OPTIONS);
}

export function verifyPassword(hashString: string, plain: string): Promise<boolean> {
  return verify(hashString, plain);
}
