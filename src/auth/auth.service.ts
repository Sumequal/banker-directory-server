import { Injectable, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { UserService } from '../user/user.service';
import { LoginDto } from './dto/login-dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  private RESET_TTL_MS = 15 * 60 * 1000; 
  private MAX_ATTEMPTS = 5;
  private LOCK_MS = 15 * 60 * 1000; 
  private RESET_PEPPER = process.env.RESET_TOKEN_PEPPER || 'change_this_reset_pepper';

 private normalizeEmail(email: string) {
  const raw = (email || '').trim();
  const decoded = decodeURIComponent(raw);
  return decoded.toLowerCase();
}


  private tokenToHash(email: string, token: string) {
    const data = `${this.normalizeEmail(email)}:${token}:${this.RESET_PEPPER}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }


  async validateUser(loginDto: LoginDto) {
  const user = await this.userService.findByEmail(loginDto.email);

  console.log("User Found:", user);

  if (!user) {
    return null;
  }

  const isMatch = await bcrypt.compare(loginDto.password, user.password);

  console.log("Password Match:", isMatch);

  if (isMatch) {
    const { password, ...result } = user.toObject();
    return result;
  }

  return null;
}

  async login(user: any) {
    const payload = {
      id: (user._id ?? user.id).toString(),
      email: user.email,
      role: user.role,
      fullName: user.fullName,
    };
    return { access_token: this.jwtService.sign(payload) };
  }


  async signup(
    email: string,
    password: string,
    role: 'admin' | 'user' | 'broker' | 'brokeradmin',
    fullName: string,
    gender?: 'male' | 'female' | 'other',
  ) {
    const userExists = await this.userService.findByEmail(email);
    if (userExists) throw new BadRequestException('User already exists');

   
    const user = await this.userService.create({
      email,
      password,
      role,
      fullName,
      ...(gender && { gender }),
    } as any);

    return this.login(user);
  }


  async sendResetPasswordEmail(emailRaw: string): Promise<string> {
    const email = this.normalizeEmail(emailRaw);

    const SAFE = 'If the email exists, a reset link has been sent.';

    const user = await this.userService.findByEmailBasic(email);
    if (!user) return SAFE;

    if (user.resetPasswordLockedUntil && user.resetPasswordLockedUntil > new Date()) {
      return SAFE;
    }

    const token = crypto.randomBytes(32).toString('hex');

    user.resetPasswordTokenHash = this.tokenToHash(email, token);
    user.resetPasswordExpiry = new Date(Date.now() + this.RESET_TTL_MS);
    user.resetPasswordAttempts = 0;
    user.resetPasswordLockedUntil = null;

    await user.save();

    
    const base =
      process.env.RESET_PASSWORD_URL ||
      process.env.BROKER_APP_URL ||
      'https://brokerf2.netlify.app';

    const link = `${base}/?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

    await this.mailService.sendResetLink(email, link);

    return SAFE;
  }

  async resetPassword(dto: ResetPasswordDto, token: string, emailRaw: string): Promise<void> {
    if (!token) throw new BadRequestException('Token is missing');

    const email = this.normalizeEmail(emailRaw);
    if (!email) throw new BadRequestException('Email is missing');

    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const user = await this.userService.findByEmailBasic(email);
    if (!user) throw new BadRequestException('Invalid or expired token');

    if (user.resetPasswordLockedUntil && user.resetPasswordLockedUntil > new Date()) {
      throw new BadRequestException('Too many attempts. Try again later.');
    }

    if (!user.resetPasswordTokenHash || !user.resetPasswordExpiry || user.resetPasswordExpiry < new Date()) {
      throw new BadRequestException('Invalid or expired token');
    }

    // attempts increment
    const attempts = (user.resetPasswordAttempts || 0) + 1;
    user.resetPasswordAttempts = attempts;

    const providedHash = this.tokenToHash(email, token);

    const a = Buffer.from(String(user.resetPasswordTokenHash));
    const b = Buffer.from(String(providedHash));
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!ok) {
      if (attempts >= this.MAX_ATTEMPTS) {
        user.resetPasswordLockedUntil = new Date(Date.now() + this.LOCK_MS);
      }
      await user.save();
      throw new BadRequestException('Invalid or expired token');
    }


    user.password = await bcrypt.hash(dto.password, 10);
    user.resetPasswordTokenHash = null;
    user.resetPasswordExpiry = null;
    user.resetPasswordAttempts = 0;
    user.resetPasswordLockedUntil = null;

    await user.save();
  }

  async getProfileByEmail(email: string) {
    return this.userService.findByEmail(email);
  }
}
