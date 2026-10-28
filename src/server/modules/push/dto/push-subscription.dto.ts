import { Type } from 'class-transformer';
import { IsNumber, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class PushKeysDto {
  @IsString() @MaxLength(256) p256dh: string;
  @IsString() @MaxLength(256) auth: string;
}

/** O `PushSubscription.toJSON()` do navegador. */
export class SavePushSubscriptionDto {
  @ApiProperty() @IsString() @MaxLength(2048) endpoint: string;

  @ApiProperty()
  @IsObject()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;

  /** Vem no toJSON() do navegador (geralmente null); a API recusava o campo. */
  @IsOptional() @IsNumber() expirationTime?: number | null;
}

export class RemovePushSubscriptionDto {
  @ApiProperty() @IsString() @MaxLength(2048) endpoint: string;

  @IsOptional() @IsString() reason?: string;
}
