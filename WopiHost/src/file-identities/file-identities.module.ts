import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StorageModule } from '../storage/storage.module';
import { FileIdentitiesService } from './file-identities.service';
import { WopiFileIdentity, WopiFileIdentitySchema } from './schemas/file-identity.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: WopiFileIdentity.name, schema: WopiFileIdentitySchema }]),
    StorageModule,
  ],
  providers: [FileIdentitiesService],
  exports: [FileIdentitiesService],
})
export class FileIdentitiesModule {}
