import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class FileIdentityMoveDto {
  @IsString() @IsNotEmpty() @MaxLength(63) sourceBucket: string;
  @IsString() @IsNotEmpty() @MaxLength(1024) sourceKey: string;
  @IsString() @IsNotEmpty() @MaxLength(63) destinationBucket: string;
  @IsString() @IsNotEmpty() @MaxLength(1024) destinationKey: string;
}
