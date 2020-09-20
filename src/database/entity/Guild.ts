import {Entity, Column, CreateDateColumn, PrimaryColumn, JoinColumn, OneToOne} from "typeorm";
import {Organization} from "./Organization";

@Entity()
export class Guild {

    @PrimaryColumn({unique: true, length: 12})
    name: string;

    @CreateDateColumn()
    tracked_since: Date;

    @Column({default: false})
    isMainnet: boolean;

    @Column({nullable: true})
    mainnet_url: string;

    // Location is stored as string rather than number to enable trailing zeros
    @Column({nullable: true})
    mainnet_location: number;

    @Column({nullable: true})
    mainnet_last_validation_id: number;

    @Column({default: false})
    isTestnet: boolean;

    @Column({nullable: true})
    testnet_url: string;

    @Column({nullable: true})
    testnet_location: number;

    @Column("int", {nullable: true})
    testnet_last_validation_id: number;
}
