import { Password } from "@convex-dev/auth/providers/Password"
import { convexAuth } from "@convex-dev/auth/server"
import { ConvexError } from "convex/values"

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password({
    profile(params) {
      const email = String(params.email ?? "").trim().toLocaleLowerCase("en-US")
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new ConvexError("Укажите корректный email")
      return { email, name: String(params.name ?? email).trim() }
    },
    validatePasswordRequirements(password) {
      if (password.length < 10 || !/[A-ZА-Я]/.test(password) || !/[a-zа-я]/.test(password) || !/\d/.test(password)) {
        throw new ConvexError("Пароль: минимум 10 символов, заглавная и строчная буквы, цифра")
      }
    },
  })],
})
