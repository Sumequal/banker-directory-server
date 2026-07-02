import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LenderModule } from './lender/lender.module';
import { BankDirectoryModule } from './bank-directory/bank-directory.module';
import { BrokerDirectoryModule } from './broker-directory/broker-directory.module';
import { ContactModule } from './contact/contact.module';
import { MailModule } from './mail/mail.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(process.env.MONGO_URI || ''),
    UserModule,
    AuthModule,
    LenderModule,
    BankDirectoryModule,
    BrokerDirectoryModule,
    ContactModule,
MailModule
 
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}