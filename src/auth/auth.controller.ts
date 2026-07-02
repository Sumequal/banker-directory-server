import {
  Controller,
  Post,
  Body,
  Query,
  BadRequestException,
  Get,
  Param,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login-dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setAuthCookie(res: Response, token: string) {
    res.cookie('token', token, {
      httpOnly: true,
      secure: true, // production mein HTTPS hai to true rakho
      sameSite: 'none', // cross-domain frontend<->backend ke liye 'none' chahiye
      domain: process.env.COOKIE_DOMAIN, // e.g. '.connectbankers.com'
      path: '/',
      maxAge: 24 * 60 * 60 * 1000, // 1 din
    });
  }

  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{
    access_token: string;
    role: 'admin' | 'user' | 'broker' | 'brokeradmin';
    redirectTo: string;
  }> {
    const user = await this.authService.validateUser(loginDto);
    if (!user) throw new BadRequestException('Invalid email or password');

    const { access_token } = await this.authService.login(user);
    const role = user.role as 'admin' | 'user' | 'broker' | 'brokeradmin';

    const redirectTo =
      role === 'broker' || role === 'brokeradmin'
        ? `${process.env.BROKER_APP_URL ?? 'https://brokerf2.netlify.app'}/directory/tasks`
        : `${process.env.BANKER_APP_URL ?? 'https://connectbankers.com'}/directory/tasks`;

    // ✅ Cookie backend se set ho rahi hai — cross-domain issue fix
    this.setAuthCookie(res, access_token);

    return { access_token, role, redirectTo };
  }

  @Post('signup')
  async signup(
    @Body() createDto: CreateUserDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{
    access_token: string;
    role: 'admin' | 'user' | 'broker' | 'brokeradmin';
    redirectTo: string;
  }> {
    const { email, password, role, fullName, gender } = createDto;

    const { access_token } = await this.authService.signup(
      email,
      password,
      role,
      fullName,
      gender,
    );

    const redirectTo =
      role === 'broker'
        ? `${process.env.BROKER_APP_URL ?? 'https://brokerf2.netlify.app'}/directory/tasks`
        : `${process.env.BANKER_APP_URL ?? 'https://connectbankers.com'}/directory/tasks`;

    // ✅ Cookie backend se set ho rahi hai
    this.setAuthCookie(res, access_token);

    return { access_token, role, redirectTo };
  }

  @Post('forgot-password')
  async forgotPassword(@Body() body: ForgotPasswordDto): Promise<{ message: string }> {
    const msg = await this.authService.sendResetPasswordEmail(body.email);
    return { message: msg };
  }

  @Post('logout')
  async logout(@Res({ passthrough: true }) res: Response) {
  res.clearCookie('token', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    domain: process.env.COOKIE_DOMAIN,
    path: '/',
  });

  return {
    message: 'Logout successful',
  };
}


  @Post('reset-password')
  async resetPassword(
    @Query('token') token: string,
    @Query('email') email: string,
    @Body() resetPasswordDto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.resetPassword(resetPasswordDto, token, email);
    return { message: 'Password reset successful' };
  }

  @Get('profile-by-email/:email')
  async getProfileByEmail(@Param('email') email: string) {
    const user = await this.authService.getProfileByEmail(email);
    if (!user) throw new BadRequestException('User not found');
    const { password, ...safeUser } = user.toObject();
    return safeUser;
  }
}