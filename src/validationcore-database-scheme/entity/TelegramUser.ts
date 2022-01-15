import { Entity, Column, PrimaryColumn } from "typeorm";

/**
 * Stores information about a telegram user (username, chatId etc.) and their preferences (e.g. if notifications for Apis are muted or not etc.)
 */
@Entity()
export class TelegramUser {
  @PrimaryColumn({ unique: true })
  chatId: number;

  @Column()
  username: string;

  @Column()
  guild: string;

  // todo: check why we need mute
  @Column("timestamp", { nullable: true })
  mainnet_mute: Date;

  @Column({ default: true })
  organization_subscribed: boolean;

  @Column({ default: true })
  producer_subscribed: boolean;

  @Column({ default: true })
  seed_subscribed: boolean;

  @Column({ default: true })
  api_subscribed: boolean;

  @Column({ default: true })
  wallet_subscribed: boolean;

  @Column({ default: true })
  history_subscribed: boolean;

  @Column({ default: true })
  hyperion_subscribed: boolean;

  @Column({ default: true })
  atomic_subscribed: boolean;
}