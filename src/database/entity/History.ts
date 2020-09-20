import {Entity, PrimaryGeneratedColumn, Column, CreateDateColumn} from "typeorm";

@Entity()
export class History {

    @PrimaryGeneratedColumn()
    id: number;

    @Column({length: 12})
    guild: string;

    @CreateDateColumn()
    validation_date: Date;

    @Column({default: false})
    all_checks_ok: boolean

    @Column()
    api_endpoint: string;

    @Column({default: false})
    is_ssl: boolean

    @Column({default: false})
    ssl_ok: boolean

    @Column({default: false})
    history_all_checks_ok: boolean

    @Column({default: false})
    history_transaction_ok: boolean

    @Column({nullable: true})
    history_transaction_ms: number

    @Column({default: false})
    history_actions_ok: boolean

    @Column({nullable: true})
    history_actions_ms: number

    @Column({default: false})
    history_key_accounts_ok: boolean

    @Column({nullable: true})
    history_key_accounts_ms: number

    @Column({default: false})
    hyperion_all_checks_ok: boolean

    @Column({default: false})
    hyperion_health_version_ok: boolean

    @Column({default: false})
    hyperion_health_host_ok: boolean

    @Column({default: false})
    hyperion_health_query_time_ok: boolean

    @Column({nullable: true})
    hyperion_health_query_time_ms: number

    @Column({default: false})
    hyperion_health_features_tables_proposals_on: boolean

    @Column({default: false})
    hyperion_health_features_tables_accounts_on: boolean

    @Column({default: false})
    hyperion_health_features_tables_voters_on: boolean

    @Column({default: false})
    hyperion_health_features_index_deltas_on: boolean

    @Column({default: false})
    hyperion_health_features_index_transfer_memo_on: boolean

    @Column({default: false})
    hyperion_health_features_index_all_deltas_on: boolean

    @Column({default: false})
    hyperion_health_features_index_failed_trx_off: boolean

    @Column({default: false})
    hyperion_health_features_index_deferred_trx_off: boolean

    @Column({default: false})
    hyperion_health_features_resource_limits_off: boolean

    @Column({default: false})
    hyperion_health_features_resource_usage_off: boolean

    @Column({default: false})
    hyperion_health_all_features_ok: boolean

    @Column({default: false})
    hyperion_health_elastic_ok: boolean

    @Column({default: false})
    hyperion_health_rabbitmq_ok: boolean

    @Column({default: false})
    hyperion_health_nodeosrpc_ok: boolean

    @Column({default: false})
    hyperion_health_total_indexed_blocks_ok: boolean

    @Column({default: false})
    hyperion_health_active_shards_ok: boolean

    @Column({default: false})
    hyperion_transaction_ok: boolean

    @Column({nullable: true})
    hyperion_transaction_ms: number

    @Column({default: false})
    hyperion_actions_ok: boolean

    @Column({nullable: true})
    hyperion_actions_ms: number

    @Column({default: false})
    hyperion_key_accounts_ok: boolean

    @Column({nullable: true})
    hyperion_key_accounts_ms: number
}
