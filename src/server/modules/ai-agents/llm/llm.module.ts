import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmService } from './llm.service';
import { AiCredentialsService } from './ai-credentials.service';
import { AiProvidersController } from './ai-providers.controller';

// Global: transcrição de áudio (messaging) e embeddings também usam as
// chaves de IA da org.
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [AiProvidersController],
  providers: [LlmService, AiCredentialsService],
  exports: [LlmService, AiCredentialsService],
})
export class LlmModule {}
