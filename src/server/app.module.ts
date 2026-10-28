import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ChannelHubModule } from './modules/channel-hub/channel-hub.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RoutingModule } from './modules/routing/routing.module';
import { QuickRepliesModule } from './modules/quick-replies/quick-replies.module';
import { AiLearningModule } from './modules/ai-learning/ai-learning.module';
import { TagsModule } from './modules/tags/tags.module';
import { ChatbotModule } from './modules/chatbot/chatbot.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { RatingsModule } from './modules/ratings/ratings.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { ChannelAccessModule } from './modules/iam/channel-access/channel-access.module';
import { AccessProfilesModule } from './modules/iam/access-profiles/access-profiles.module';
import { AiAgentsModule } from './modules/ai-agents/ai-agents.module';
import { InboxViewsModule } from './modules/inbox-views/inbox-views.module';
import { PushModule } from './modules/push/push.module';
import { PipelinesModule } from './modules/pipelines/pipelines.module';
import { SegmentsModule } from './modules/segments/segments.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { SalesRecoveryModule } from './modules/sales-recovery/sales-recovery.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { GroupMonitorModule } from './modules/group-monitor/group-monitor.module';
// ProductsModule removido — catálogo agora vive no Trivapp e é consumido
// via skill HTTP getProductPitch + CatalogSyncService. Tabela `products`
// fica órfã no DB (cleanup futuro). Não importar aqui.

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Filas em Postgres (runtime/pg-queue.ts, instalado em runtime/install.ts):
    // o @nestjs/bullmq segue provendo @InjectQueue/@Processor, sem Redis.
    // `connection` é exigido pelo tipo e ignorado pela PgQueue.
    BullModule.forRoot({ connection: {} }),
    PrismaModule,
    // AutomationsModule is @Global — register early so every domain
    // module can inject OutboxService without explicit imports.
    AutomationsModule,
    ChannelAccessModule,
    AccessProfilesModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    RealtimeModule,
    ChannelHubModule,
    MessagingModule,
    NotificationsModule,
    RoutingModule,
    QuickRepliesModule,
    AiLearningModule,
    TagsModule,
    ChatbotModule,
    DashboardModule,
    RatingsModule,
    ApiKeysModule,
    PublicApiModule,
    AiAgentsModule,
    InboxViewsModule,
    PushModule,
    PipelinesModule,
    SegmentsModule,
    ProjectsModule,
    SalesRecoveryModule,
    GroupMonitorModule,
  ],
})
export class AppModule {}
